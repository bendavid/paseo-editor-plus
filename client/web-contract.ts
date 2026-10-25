import type { PluginTheme } from "@getpaseo/plugin";
import type { PreviewFrame } from "../shared/rpc";

// The contract between the cross-platform panel and the web-only modules in client/web/. Keep it
// free of DOM types: the panel is type-checked without the DOM library, and the native apps
// evaluate it.

/** A zero-based line and a column in characters (code points), as tinymist's preview counts. */
export interface CharPosition {
  line: number;
  character: number;
}

export interface CodeEditor {
  setText(text: string): void;
  reveal(start: CharPosition, end?: CharPosition | null): void;
  cursor(): CharPosition;
  /** Connects the editor to a language server; null disconnects it. */
  setLanguageClient(client: LanguageClient | null, file: LanguageClientFile | null): void;
  /** Requests semantic tokens again, when the server asks. */
  refreshSemanticTokens(): void;
  format(): void;
  setTheme(theme: PluginTheme): void;
  focus(): void;
  destroy(): void;
}

export interface LanguageClientFile {
  uri: string;
  languageId: string;
  /** Semantic token types left to the editor's own highlighting. */
  plainTokenTypes: readonly string[];
}

export interface CodeEditorOptions {
  /** On web, a React Native `View` ref is its DOM element. */
  parent: unknown;
  /** A language id from shared/languages.ts, for the editor's own parser and highlighting. */
  language: string;
  /** The file's extension, lowercase without the dot; some languages parse by it (TSX, SCSS). */
  extension: string;
  text: string;
  theme: PluginTheme;
  onChange(text: string): void;
  /** `pointer` is true when a click or drag moved the cursor. */
  onCursor(position: CharPosition, pointer: boolean): void;
}

/** The transport @codemirror/lsp-client reads and writes JSON-RPC messages through. */
export interface MessageTransport {
  send(message: string): void;
  subscribe(handler: (message: string) => void): void;
  unsubscribe(handler: (message: string) => void): void;
}

export interface LanguageClient {
  readonly initializing: Promise<unknown>;
  request(method: string, params: unknown): Promise<unknown>;
  disconnect(): void;
}

export interface LanguageClientOptions {
  rootUri: string;
  transport: MessageTransport;
  initializationOptions: Record<string, unknown>;
  otherFile(uri: string): void;
}

export interface PreviewChannel {
  reconnect(): Promise<void>;
  send(message: string): void;
}

export interface PreviewView {
  deliver(frame: PreviewFrame): void;
  setInvert(invert: boolean): void;
  setBackground(color: string): void;
  destroy(): void;
}

export interface WebModules {
  createEditor(options: CodeEditorOptions): CodeEditor;
  createLanguageClient(options: LanguageClientOptions): LanguageClient;
  mountPreview(
    parent: unknown,
    html: string,
    channel: PreviewChannel,
    options: {
      invert: boolean;
      background: string;
      /** The element that holds the rendered document, which inverting recolours. */
      invertTarget: string;
    },
  ): PreviewView;
}
