// The transport between CodeMirror's language client and the language server. It also answers
// the requests a server sends to its client that @codemirror/lsp-client would refuse, and offers
// notifications to the panel (a preview's jumps, for example) before the client sees them.

export interface TransportHooks {
  /** A notification from the server; return true when it is handled and the client should not see it. */
  notification(method: string, params: unknown): boolean;
  /** The server asked for semantic tokens to be requested again. */
  refreshSemanticTokens(): void;
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
    /** The server's settings, for `workspace/configuration`. */
    private readonly configuration: Readonly<Record<string, unknown>>,
    /** The section name the server asks for, such as "tinymist". */
    private readonly section: string,
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

  /** A message from the server. */
  receive(message: string): void {
    let parsed: JsonRpcMessage;
    try {
      parsed = JSON.parse(message) as JsonRpcMessage;
    } catch {
      return;
    }
    if (parsed.method !== undefined && parsed.id !== undefined) {
      if (this.answer(parsed.id, parsed.method, parsed.params)) return;
    } else if (parsed.method !== undefined) {
      if (this.hooks.notification(parsed.method, parsed.params)) return;
    }
    for (const handler of this.handlers) handler(message);
  }

  private answer(id: number | string, method: string, params: unknown): boolean {
    let result: unknown;
    switch (method) {
      case "workspace/configuration": {
        const items = (params as { items?: { section?: string }[] } | undefined)?.items ?? [];
        result = items.map((item) =>
          item.section === this.section || item.section === undefined ? this.configuration : null,
        );
        break;
      }
      case "workspace/semanticTokens/refresh":
        this.hooks.refreshSemanticTokens();
        result = null;
        break;
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
