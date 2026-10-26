// The transport between CodeMirror's language client and the language server. It also answers
// the requests a server sends to its client that @codemirror/lsp-client would refuse, offers
// notifications to the panel (a preview's jumps, for example) before the client sees them, and
// adds the panel's own diagnostics (a LaTeX build log's errors) to the server's.

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

/** An LSP diagnostic, as far as merging needs it. */
export interface LspDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity?: number;
  source?: string;
  message: string;
}

const PUBLISH = "textDocument/publishDiagnostics";

/** URIs as servers and clients spell them differently (percent-encoding, drive letters). */
function sameUri(a: string, b: string): boolean {
  const normal = (uri: string) => {
    try {
      return decodeURIComponent(uri).toLowerCase();
    } catch {
      return uri.toLowerCase();
    }
  };
  return normal(a) === normal(b);
}

/** The same problem reported twice: same line, same message (ignoring a final period and case). */
function sameProblem(a: LspDiagnostic, b: LspDiagnostic): boolean {
  const text = (message: string) => message.trim().replace(/\.$/, "").toLowerCase();
  return a.range.start.line === b.range.start.line && text(a.message) === text(b.message);
}

export class LspTransport {
  private readonly handlers = new Set<(message: string) => void>();
  /** The server's latest diagnostics, and the panel's own, per document URI. */
  private readonly serverDiagnostics = new Map<string, LspDiagnostic[]>();
  private readonly extraDiagnostics = new Map<string, LspDiagnostic[]>();
  /** The rest of the server's last publication per URI (its document version). */
  private readonly serverParams = new Map<string, object>();

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
      if (parsed.method === PUBLISH) {
        const params = parsed.params as { uri?: string; diagnostics?: LspDiagnostic[] } | undefined;
        if (params?.uri) {
          this.serverDiagnostics.set(params.uri, params.diagnostics ?? []);
          this.serverParams.set(params.uri, params);
          // Without diagnostics of its own for the document, the server's message goes as it is.
          if (this.extraFor(params.uri).length > 0) {
            this.publish(params.uri);
            return;
          }
        }
      }
    }
    for (const handler of this.handlers) handler(message);
  }

  /**
   * Diagnostics the panel found itself for a document, shown with the server's; problems the server
   * already reports are not repeated.
   */
  setExtraDiagnostics(uri: string, diagnostics: LspDiagnostic[]): void {
    for (const key of [...this.extraDiagnostics.keys()]) {
      if (sameUri(key, uri)) this.extraDiagnostics.delete(key);
    }
    this.extraDiagnostics.set(uri, diagnostics);
    // Publish under the server's spelling of the URI when it has published for this document.
    const known = [...this.serverDiagnostics.keys()].find((key) => sameUri(key, uri));
    this.publish(known ?? uri);
  }

  private extraFor(uri: string): LspDiagnostic[] {
    const key = [...this.extraDiagnostics.keys()].find((other) => sameUri(other, uri));
    return (key ? this.extraDiagnostics.get(key) : undefined) ?? [];
  }

  private publish(uri: string): void {
    const server = this.serverDiagnostics.get(uri) ?? [];
    const diagnostics = [
      ...server,
      ...this.extraFor(uri).filter((mine) => !server.some((theirs) => sameProblem(mine, theirs))),
    ];
    const message = JSON.stringify({
      jsonrpc: "2.0",
      method: PUBLISH,
      params: { ...this.serverParams.get(uri), uri, diagnostics },
    });
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
