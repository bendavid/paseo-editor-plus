// The transport between CodeMirror's language client and tinymist. It also answers the requests
// tinymist sends to its client, which @codemirror/lsp-client would refuse, and takes the
// preview's notifications for the panel.

/** Where the preview says a clicked spot is in the source. Columns count characters. */
export interface SourceJump {
  filepath: string;
  start: [number, number] | null;
  end: [number, number] | null;
}

export interface TransportHooks {
  /** The preview asks the editor to show a source location. */
  scrollSource(jump: SourceJump): void;
}

interface JsonRpcMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
}

export class LspTransport {
  private readonly handlers = new Set<(message: string) => void>();

  constructor(
    private readonly sendRaw: (message: string) => void,
    private readonly hooks: TransportHooks,
    /** The `tinymist` configuration section, for `workspace/configuration`. */
    private readonly configuration: Record<string, unknown>,
  ) {}

  send(message: string): void {
    this.sendRaw(message);
  }

  subscribe(handler: (message: string) => void): void {
    this.handlers.add(handler);
  }

  unsubscribe(handler: (message: string) => void): void {
    this.handlers.delete(handler);
  }

  /** A message from tinymist. */
  receive(message: string): void {
    let parsed: JsonRpcMessage;
    try {
      parsed = JSON.parse(message) as JsonRpcMessage;
    } catch {
      return;
    }
    if (parsed.method !== undefined && parsed.id !== undefined) {
      if (this.answer(parsed.id, parsed.method, parsed.params)) return;
    } else if (parsed.method === "tinymist/preview/scrollSource") {
      this.hooks.scrollSource(parsed.params as SourceJump);
      return;
    } else if (parsed.method !== undefined && parsed.method.startsWith("tinymist/")) {
      // The document outline and other tinymist extensions the editor does not use.
      return;
    }
    for (const handler of this.handlers) handler(message);
  }

  private answer(id: number | string, method: string, params: unknown): boolean {
    let result: unknown;
    switch (method) {
      case "workspace/configuration": {
        const items = (params as { items?: { section?: string }[] } | undefined)?.items ?? [];
        result = items.map((item) =>
          item.section === "tinymist" || item.section === undefined ? this.configuration : null,
        );
        break;
      }
      case "window/workDoneProgress/create":
      case "client/registerCapability":
      case "client/unregisterCapability":
        result = null;
        break;
      default:
        return false;
    }
    this.sendRaw(JSON.stringify({ jsonrpc: "2.0", id, result }));
    return true;
  }
}
