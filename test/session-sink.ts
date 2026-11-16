import type { EditorSession } from "../server/session";
import type { SessionEvent } from "../shared/rpc";

/** What a session pushed since the last `take`. */
export interface Taken {
  alive: boolean;
  exit: string | null;
  lsp: string[];
  /** Preview messages: bytes, or the JSON events. */
  preview: SessionEvent[];
}

/** Stands in for the app's subscription: attaches to a session and collects what it pushes. */
export class SessionSink {
  private lsp: string[] = [];
  private preview: SessionEvent[] = [];
  private ended: string | null = null;
  private wake: (() => void) | null = null;
  private readonly controller = new AbortController();
  readonly done: Promise<void>;

  constructor(session: EditorSession) {
    this.done = session.attach(async (event) => {
      if (event instanceof Uint8Array) this.preview.push(event);
      else if (event.type === "lsp") this.lsp.push(...event.messages);
      else if (event.type === "ended") this.ended = event.reason;
      else this.preview.push(event);
      this.wake?.();
    }, this.controller.signal);
  }

  /** Waits up to `waitMs` for something to arrive, then returns and clears what did. */
  async take(waitMs: number): Promise<Taken> {
    if (this.lsp.length === 0 && this.preview.length === 0 && this.ended === null && waitMs > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, waitMs);
        const sink = this;
        function done() {
          clearTimeout(timer);
          sink.wake = null;
          resolve();
        }
        this.wake = done;
      });
    }
    const taken = {
      alive: this.ended === null,
      exit: this.ended,
      lsp: this.lsp,
      preview: this.preview,
    };
    this.lsp = [];
    this.preview = [];
    return taken;
  }

  detach(): void {
    this.controller.abort();
  }
}
