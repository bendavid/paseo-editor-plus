import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { PreviewFrame } from "../shared/rpc";
import { frameLspMessage, LspMessageReader } from "./framing";

/** How long tinymist gets to exit after its input closes, before it is killed. */
const EXIT_GRACE_MS = 2000;
/** Warnings and errors from tinymist's log kept to explain a crash. */
const LOG_LINES = 20;
const NOTEWORTHY = /\b(ERROR|WARN)\b|panicked/;
/**
 * Preview data held for an app that stopped polling. Past this the frames are dropped and the
 * preview reconnects, which makes tinymist send the whole document again.
 */
const MAX_QUEUED_PREVIEW_BYTES = 64 * 1024 * 1024;
/** After a message arrives, wait this long for more before answering a poll. */
const BATCH_MS = 8;

export interface PollResult {
  alive: boolean;
  exit: string | null;
  lsp: string[];
  preview: PreviewFrame[];
}

export interface SessionOptions {
  id: string;
  binary: string;
  root: string;
}

/** One `tinymist lsp` process and its preview connection, for one editor tab. */
export class TypstSession {
  readonly id: string;
  /** When the app last polled; sessions it abandons are closed. */
  lastSeen = Date.now();
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly reader = new LspMessageReader();
  private lsp: string[] = [];
  private preview: PreviewFrame[] = [];
  private previewBytes = 0;
  private waiters: (() => void)[] = [];
  private exitReason: string | null = null;
  private readonly log: string[] = [];
  private readonly previewPorts = new Set<number>();
  private socket: WebSocket | null = null;
  private closed = false;

  constructor({ id, binary, root }: SessionOptions) {
    this.id = id;
    this.process = spawn(binary, ["lsp"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
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
    this.process.on("error", (error) => this.ended(`tinymist could not start: ${error.message}`));
    this.process.on("exit", (code, signal) => {
      if (this.closed) return;
      if (signal) {
        this.ended(`tinymist was stopped (${signal}).`);
        return;
      }
      const tail = this.log.slice(-4).join("\n");
      this.ended(`tinymist exited with code ${code}.${tail ? `\n${tail}` : ""}`);
    });
    // Writing after tinymist exits raises EPIPE on the stream; the exit handler reports it.
    this.process.stdin.on("error", () => {});
  }

  get alive(): boolean {
    return this.exitReason === null;
  }

  sendLsp(messages: readonly string[]): boolean {
    if (!this.alive) return false;
    for (const message of messages) this.process.stdin.write(frameLspMessage(message));
    return true;
  }

  /** Answers with whatever is queued, waiting up to `waitMs` for something to arrive. */
  async poll(waitMs: number): Promise<PollResult> {
    this.lastSeen = Date.now();
    if (!this.hasOutput() && this.alive && waitMs > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, waitMs);
        function done() {
          clearTimeout(timer);
          resolve();
        }
        this.waiters.push(done);
      });
    }
    this.lastSeen = Date.now();
    const result: PollResult = {
      alive: this.alive,
      exit: this.exitReason,
      lsp: this.lsp,
      preview: this.preview,
    };
    this.lsp = [];
    this.preview = [];
    this.previewBytes = 0;
    return result;
  }

  /**
   * Connects to the preview server tinymist started for this session, replacing any earlier
   * connection, and returns the preview page when asked.
   */
  async connectPreview(port: number, includeHtml: boolean): Promise<string | null> {
    if (!this.previewPorts.has(port)) {
      throw new Error(`tinymist did not start a preview on port ${port} for this tab.`);
    }
    const WebSocketClass = globalThis.WebSocket;
    if (!WebSocketClass) {
      throw new Error(
        "The daemon's Node.js has no WebSocket client; Node.js 22 or later is needed.",
      );
    }
    const html = includeHtml ? await (await fetch(`http://127.0.0.1:${port}/`)).text() : null;
    this.disconnectPreview();
    // tinymist checks the Origin a browser would send for its own page, and will require it.
    const init = { headers: { Origin: `http://127.0.0.1:${port}` } };
    const socket = new WebSocketClass(`ws://127.0.0.1:${port}/`, init as unknown as string[]);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("Could not connect to the tinymist preview."));
    });
    socket.onerror = null;
    socket.onmessage = (event: MessageEvent) => {
      if (this.socket !== socket) return;
      const frame: PreviewFrame =
        typeof event.data === "string"
          ? { t: "text", d: event.data }
          : { t: "binary", d: Buffer.from(event.data as ArrayBuffer).toString("base64") };
      this.queuePreview(frame);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.queuePreview({ t: "close", d: "" });
    };
    return html;
  }

  sendPreview(messages: readonly string[]): boolean {
    if (!this.alive) return false;
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
    // tinymist exits when its input ends; make sure it does.
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
    // The response to tinymist.doStartPreview names the port of the preview server.
    if (message.includes('"dataPlanePort"')) {
      try {
        const port = (JSON.parse(message) as { result?: { dataPlanePort?: unknown } }).result
          ?.dataPlanePort;
        if (typeof port === "number") this.previewPorts.add(port);
      } catch {
        // Not a message we need to read.
      }
    }
    this.lsp.push(message);
    this.wake();
  }

  private queuePreview(frame: PreviewFrame): void {
    this.previewBytes += frame.d.length;
    if (this.previewBytes > MAX_QUEUED_PREVIEW_BYTES) {
      // The app is not keeping up. Start over from a fresh connection.
      this.preview = [{ t: "close", d: "" }];
      this.previewBytes = 0;
      this.disconnectPreview();
    } else {
      this.preview.push(frame);
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
