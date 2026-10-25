import type { PreviewFrame } from "../shared/rpc";

// The app's side of a session. Plugin calls are request and response only, so the connection
// keeps one poll open; the server answers it as soon as tinymist or the preview has something.
// Messages to the server go out one call at a time so they arrive in order.

/** Long enough to idle cheaply, short enough for the daemon's 30-second call limit. */
const POLL_WAIT_MS = 20_000;
/** Polls that fail in a row before the connection gives up. */
const MAX_POLL_FAILURES = 5;

export interface SessionCalls {
  send(input: { sessionId: string; messages: string[] }): Promise<{ alive: boolean }>;
  poll(input: { sessionId: string; waitMs: number }): Promise<{
    alive: boolean;
    exit: string | null;
    lsp: string[];
    preview: PreviewFrame[];
  }>;
  sendPreview(input: { sessionId: string; messages: string[] }): Promise<{ alive: boolean }>;
  close(input: { sessionId: string }): Promise<unknown>;
}

export interface ConnectionHandlers {
  /** A message from tinymist that the editor's language client should see. */
  lsp(message: string): void;
  preview(frame: PreviewFrame): void;
  /** The session ended: tinymist exited, or the daemon cannot be reached. */
  ended(reason: string): void;
}

/** A queue that sends batches through `send`, one call at a time, in order. */
class OrderedSender {
  private queue: string[] = [];
  private sending = false;

  constructor(
    private readonly send: (messages: string[]) => Promise<void>,
    private readonly failed: (error: unknown) => void,
  ) {}

  push(message: string): void {
    this.queue.push(message);
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.queue.length > 0) {
        const batch = this.queue;
        this.queue = [];
        await this.send(batch);
      }
    } catch (error) {
      this.queue = [];
      this.failed(error);
    } finally {
      this.sending = false;
    }
  }
}

export class TypstConnection {
  private running = true;
  private readonly lspOut: OrderedSender;
  private readonly previewOut: OrderedSender;

  constructor(
    private readonly calls: SessionCalls,
    readonly sessionId: string,
    private readonly handlers: ConnectionHandlers,
  ) {
    this.lspOut = new OrderedSender(
      async (messages) => {
        const { alive } = await calls.send({ sessionId, messages });
        if (!alive) this.end("tinymist is no longer running.");
      },
      (error) => this.end(`Could not reach tinymist: ${messageOf(error)}`),
    );
    this.previewOut = new OrderedSender(
      async (messages) => {
        await calls.sendPreview({ sessionId, messages });
      },
      () => {},
    );
    void this.pollLoop();
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
    void this.calls.close({ sessionId: this.sessionId }).catch(() => {});
  }

  private end(reason: string): void {
    if (!this.running) return;
    this.running = false;
    this.handlers.ended(reason);
  }

  private async pollLoop(): Promise<void> {
    let failures = 0;
    while (this.running) {
      let result;
      try {
        result = await this.calls.poll({ sessionId: this.sessionId, waitMs: POLL_WAIT_MS });
        failures = 0;
      } catch (error) {
        failures += 1;
        if (failures >= MAX_POLL_FAILURES) {
          this.end(`Lost the connection to tinymist: ${messageOf(error)}`);
          return;
        }
        await delay(1000 * failures);
        continue;
      }
      if (!this.running) return;
      for (const message of result.lsp) this.handlers.lsp(message);
      for (const frame of result.preview) this.handlers.preview(frame);
      if (!result.alive) {
        this.end(result.exit ?? "tinymist stopped.");
        return;
      }
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
