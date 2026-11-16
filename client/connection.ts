import type { SubscriptionEvent } from "@getpaseo/plugin";
import type { sessionEvents } from "../shared/rpc";
import type { PreviewFrame } from "./web-contract";

// The app's side of a session. The language server's messages and the preview's arrive on the
// session's subscription, which Paseo renews after the app reconnects; the daemon keeps them
// queued meanwhile. Messages to the server go out one call at a time so they arrive in order, and a
// call that fails (the app is reconnecting) is made again with the same batch number, which the
// session uses to skip a batch it already has.

/** How long a batch is retried before the connection gives up: the daemon keeps a session this long. */
const RETRY_FOR_MS = 60_000;
/** The longest wait between attempts. */
const MAX_RETRY_DELAY_MS = 4000;

export type SessionEventData = SubscriptionEvent<typeof sessionEvents>;

export interface SessionCalls {
  send(input: { sessionId: string; seq: number; messages: string[] }): Promise<{ alive: boolean }>;
  sendPreview(input: {
    sessionId: string;
    seq: number;
    messages: string[];
  }): Promise<{ alive: boolean }>;
  close(input: { sessionId: string }): Promise<unknown>;
  /**
   * Subscribes to the session's events. `closed` runs when the daemon ends the subscription, with
   * an error unless the session ended normally. Returns the release.
   */
  subscribe(
    sessionId: string,
    event: (event: SessionEventData) => void,
    closed: (error?: Error) => void,
  ): () => void;
}

export interface ConnectionHandlers {
  /** A message from the language server that the editor's language client should see. */
  lsp(message: string): void;
  preview(frame: PreviewFrame): void;
  /** The session ended: the language server exited, or the daemon cannot be reached. */
  ended(reason: string): void;
}

/**
 * A queue that sends numbered batches through `send`, one call at a time, in order, retrying a
 * failed call until `RETRY_FOR_MS` has passed.
 */
export class OrderedSender {
  private queue: string[] = [];
  private sending = false;
  private seq = 0;
  private stopped = false;

  constructor(
    private readonly send: (seq: number, messages: string[]) => Promise<void>,
    private readonly failed: (error: unknown) => void,
    private readonly wait: (ms: number) => Promise<void> = delay,
  ) {}

  push(message: string): void {
    if (this.stopped) return;
    this.queue.push(message);
    void this.flush();
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
  }

  private async flush(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.queue.length > 0 && !this.stopped) {
        const batch = this.queue;
        this.queue = [];
        this.seq += 1;
        await this.deliver(this.seq, batch);
      }
    } catch (error) {
      this.stop();
      this.failed(error);
    } finally {
      this.sending = false;
    }
  }

  private async deliver(seq: number, batch: string[]): Promise<void> {
    const started = Date.now();
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.send(seq, batch);
        return;
      } catch (error) {
        if (this.stopped || Date.now() - started >= RETRY_FOR_MS) throw error;
        await this.wait(Math.min(MAX_RETRY_DELAY_MS, 250 * 2 ** attempt));
      }
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SessionConnection {
  private running = true;
  private readonly lspOut: OrderedSender;
  private readonly previewOut: OrderedSender;
  private readonly release: () => void;

  constructor(
    private readonly calls: SessionCalls,
    readonly sessionId: string,
    private readonly handlers: ConnectionHandlers,
  ) {
    this.lspOut = new OrderedSender(
      async (seq, messages) => {
        const { alive } = await calls.send({ sessionId, seq, messages });
        if (!alive) this.end("the language server is no longer running.");
      },
      (error) => this.end(`Could not reach the language server: ${messageOf(error)}`),
    );
    this.previewOut = new OrderedSender(
      async (seq, messages) => {
        await calls.sendPreview({ sessionId, seq, messages });
      },
      () => {},
    );
    this.release = calls.subscribe(
      sessionId,
      (event) => this.receive(event),
      (error) =>
        this.end(
          error
            ? `Lost the connection to the language server: ${error.message}`
            : "the language server stopped.",
        ),
    );
  }

  get active(): boolean {
    return this.running;
  }

  sendLsp(message: string): void {
    if (this.running) this.lspOut.push(message);
  }

  sendPreview(message: string): void {
    if (this.running) this.previewOut.push(message);
  }

  close(): void {
    if (!this.running) return;
    this.running = false;
    this.lspOut.stop();
    this.previewOut.stop();
    this.release();
    void this.calls.close({ sessionId: this.sessionId }).catch(() => {});
  }

  private receive(event: SessionEventData): void {
    if (!this.running) return;
    if (event instanceof Uint8Array) {
      this.handlers.preview({ kind: "binary", bytes: event });
      return;
    }
    switch (event.type) {
      case "lsp":
        for (const message of event.messages) this.handlers.lsp(message);
        return;
      case "preview":
        this.handlers.preview({ kind: "text", text: event.text });
        return;
      case "previewClosed":
        this.handlers.preview({ kind: "closed" });
        return;
      case "ended":
        this.end(event.reason);
        return;
    }
  }

  private end(reason: string): void {
    if (!this.running) return;
    this.running = false;
    this.lspOut.stop();
    this.previewOut.stop();
    this.release();
    this.handlers.ended(reason);
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
