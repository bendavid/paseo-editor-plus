import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { PreviewKind } from "../shared/languages";
import type { SessionEvent } from "../shared/rpc";
import { frameLspMessage, LspMessageReader } from "./framing";
import { announcedPreviewPorts } from "./previews";

/** How long the language server gets to exit after its input closes, before it is killed. */
const EXIT_GRACE_MS = 2000;
/** Warnings and errors from the server's log kept to explain a crash. */
const LOG_LINES = 20;
const NOTEWORTHY = /\b(ERROR|WARN)\b|panicked/;
/**
 * Preview data held while no app is attached, or while it falls behind. Past this the frames are
 * dropped and the preview reconnects, which makes the server send the whole document again.
 */
const MAX_QUEUED_PREVIEW_BYTES = 64 * 1024 * 1024;
/** After a message arrives, wait this long for more so that they go out together. */
const BATCH_MS = 8;

/** A preview WebSocket message, or the connection's end. */
type PreviewItem =
  | { kind: "text"; text: string }
  | { kind: "binary"; bytes: Uint8Array<ArrayBuffer> }
  | { kind: "closed" };

/** Sends one event to the attached app; resolves once it has left the plugin process. */
export type PushEvent = (event: SessionEvent) => Promise<void>;

export interface SessionOptions {
  id: string;
  /** The language server's executable, arguments, and extra environment. */
  command: string;
  args: readonly string[];
  env?: Record<string, string>;
  /** Shown in messages, such as "tinymist". */
  name: string;
  root: string;
  preview: PreviewKind | null;
}

/**
 * One language server process and its preview connection, for one editor tab. Output waits in
 * queues until the tab's subscription is attached (`attach`), which also carries it across the
 * app reconnecting: Paseo subscribes again, and the new subscription takes the queues over.
 */
export class EditorSession {
  readonly id: string;
  /** Since when no subscription is attached; null while one is. Detached sessions are reaped. */
  detachedSince: number | null = Date.now();
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly reader = new LspMessageReader();
  private lsp: string[] = [];
  private preview: PreviewItem[] = [];
  /** The attached subscription. */
  private subscriber: symbol | null = null;
  /** The last batch numbers passed on (see `sendLsp`). */
  private lspSeq = 0;
  private previewSeq = 0;
  private previewBytes = 0;
  private waiters: (() => void)[] = [];
  private exitReason: string | null = null;
  private readonly log: string[] = [];
  private readonly previewPorts = new Set<number>();
  private socket: WebSocket | null = null;
  private closed = false;

  private readonly name: string;
  private readonly previewKind: PreviewKind | null;

  constructor({ id, command, args, env, name, root, preview }: SessionOptions) {
    this.id = id;
    this.name = name;
    this.previewKind = preview;
    this.process = spawn(command, [...args], {
      cwd: root,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process.stdout.on("data", (chunk: Buffer) => {
      for (const message of this.reader.push(chunk)) this.fromServer(message);
    });
    this.process.stderr.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        if (!NOTEWORTHY.test(line)) continue;
        this.log.push(line.trim());
        if (this.log.length > LOG_LINES) this.log.shift();
      }
    });
    this.process.on("error", (error) =>
      this.ended(`${this.name} could not start: ${error.message}`),
    );
    this.process.on("exit", (code, signal) => {
      if (this.closed) return;
      if (signal) {
        this.ended(`${this.name} was stopped (${signal}).`);
        return;
      }
      const tail = this.log.slice(-4).join("\n");
      this.ended(`${this.name} exited with code ${code}.${tail ? `\n${tail}` : ""}`);
    });
    // Writing after the server exits raises EPIPE on the stream; the exit handler reports it.
    this.process.stdin.on("error", () => {});
  }

  get alive(): boolean {
    return this.exitReason === null;
  }

  /** Passes a batch to the language server, unless batch `seq` already was (a resent call). */
  sendLsp(messages: readonly string[], seq: number): boolean {
    if (!this.alive) return false;
    if (seq <= this.lspSeq) return true;
    this.lspSeq = seq;
    for (const message of messages) this.process.stdin.write(frameLspMessage(message));
    return true;
  }

  /**
   * Sends the session's output to a subscription until `signal` aborts, another subscription
   * attaches, or the session ends; then resolves, after an "ended" event in the last case.
   */
  async attach(push: PushEvent, signal: AbortSignal): Promise<void> {
    const token = Symbol("subscriber");
    this.subscriber = token;
    this.detachedSince = null;
    // A pump still waiting for an earlier subscription stops.
    this.wake();
    const current = () => !signal.aborted && this.subscriber === token;
    try {
      while (current()) {
        if (!this.hasOutput()) {
          if (!this.alive) {
            await push({ type: "ended", reason: this.exitReason ?? "The session ended." });
            return;
          }
          await this.nextOutput(signal);
          continue;
        }
        const lsp = this.lsp;
        const preview = this.preview;
        this.lsp = [];
        this.preview = [];
        this.previewBytes = 0;
        if (lsp.length > 0) {
          if (!current()) {
            this.requeue(lsp, preview);
            return;
          }
          await push({ type: "lsp", messages: lsp });
        }
        for (let index = 0; index < preview.length; index += 1) {
          if (!current()) {
            this.requeue([], preview.slice(index));
            return;
          }
          await push(previewEvent(preview[index]));
        }
      }
    } finally {
      if (this.subscriber === token) {
        this.subscriber = null;
        this.detachedSince = Date.now();
      }
    }
  }

  /**
   * Connects to the preview server started for this session, replacing any earlier
   * connection, and returns the preview page when asked.
   */
  async connectPreview(port: number, includeHtml: boolean): Promise<string | null> {
    if (!this.previewPorts.has(port)) {
      throw new Error(`${this.name} did not start a preview on port ${port} for this tab.`);
    }
    const WebSocketClass = globalThis.WebSocket;
    if (!WebSocketClass) {
      throw new Error(
        "The daemon's Node.js has no WebSocket client; Node.js 22 or later is needed.",
      );
    }
    const html = includeHtml ? await (await fetch(`http://127.0.0.1:${port}/`)).text() : null;
    this.disconnectPreview();
    // Preview servers check the Origin a browser would send for their own page (tinymist will
    // require it).
    const init = { headers: { Origin: `http://127.0.0.1:${port}` } };
    const socket = new WebSocketClass(`ws://127.0.0.1:${port}/`, init as unknown as string[]);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error(`Could not connect to the ${this.name} preview.`));
    });
    socket.onerror = null;
    socket.onmessage = (event: MessageEvent) => {
      if (this.socket !== socket) return;
      this.queuePreview(
        typeof event.data === "string"
          ? { kind: "text", text: event.data }
          : { kind: "binary", bytes: new Uint8Array(event.data as ArrayBuffer) },
      );
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.queuePreview({ kind: "closed" });
    };
    return html;
  }

  sendPreview(messages: readonly string[], seq: number): boolean {
    if (!this.alive) return false;
    if (seq <= this.previewSeq) return true;
    this.previewSeq = seq;
    const socket = this.socket;
    if (socket && socket.readyState === socket.OPEN) {
      for (const message of messages) socket.send(message);
    }
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.disconnectPreview();
    if (this.exitReason === null) this.exitReason = "The session was closed.";
    this.wake();
    // Language servers exit when their input ends; make sure this one does.
    this.process.stdin.end();
    const killTimer = setTimeout(() => this.process.kill("SIGKILL"), EXIT_GRACE_MS * 2);
    killTimer.unref();
    const termTimer = setTimeout(() => this.process.kill("SIGTERM"), EXIT_GRACE_MS);
    termTimer.unref();
    this.process.once("exit", () => {
      clearTimeout(termTimer);
      clearTimeout(killTimer);
    });
  }

  private fromServer(message: string): void {
    for (const port of announcedPreviewPorts(this.previewKind, message))
      this.previewPorts.add(port);
    this.lsp.push(message);
    this.wake();
  }

  private queuePreview(item: PreviewItem): void {
    this.previewBytes += itemSize(item);
    if (this.previewBytes > MAX_QUEUED_PREVIEW_BYTES) {
      // The app is not keeping up. Start over from a fresh connection.
      this.preview = [{ kind: "closed" }];
      this.previewBytes = 0;
      this.disconnectPreview();
    } else {
      this.preview.push(item);
    }
    this.wake();
  }

  private disconnectPreview(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
  }

  private ended(reason: string): void {
    if (this.exitReason === null) this.exitReason = reason;
    this.disconnectPreview();
    this.wake();
  }

  /** Puts output a subscription did not send back at the front of the queues. */
  private requeue(lsp: string[], preview: PreviewItem[]): void {
    this.lsp = [...lsp, ...this.lsp];
    this.preview = [...preview, ...this.preview];
    this.previewBytes = this.preview.reduce((total, item) => total + itemSize(item), 0);
  }

  /** Resolves when output arrives, the session ends, another subscription attaches, or `signal` aborts. */
  private nextOutput(signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = () => {
        signal.removeEventListener("abort", done);
        resolve();
      };
      signal.addEventListener("abort", done, { once: true });
      this.waiters.push(done);
    });
  }

  private hasOutput(): boolean {
    return this.lsp.length > 0 || this.preview.length > 0;
  }

  private wake(): void {
    if (this.waiters.length === 0) return;
    const waiters = this.waiters;
    this.waiters = [];
    // Let messages that arrive together go out in one answer.
    setTimeout(() => {
      for (const waiter of waiters) waiter();
    }, BATCH_MS);
  }
}

function itemSize(item: PreviewItem): number {
  return item.kind === "text" ? item.text.length : item.kind === "binary" ? item.bytes.length : 0;
}

/** Binary messages travel as raw bytes; everything else as JSON. */
function previewEvent(item: PreviewItem): SessionEvent {
  switch (item.kind) {
    case "binary":
      return item.bytes;
    case "text":
      return { type: "preview", text: item.text };
    case "closed":
      return { type: "previewClosed" };
  }
}
