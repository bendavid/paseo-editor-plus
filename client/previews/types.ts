import type { PluginTheme, RpcInput, RpcOutput } from "@getpaseo/plugin";
import type {
  connectPreview,
  locatePdf,
  pdfjsBinary,
  pdfjsPart,
  PreviewFrame,
  readPdf,
  renderMarkdown,
  statPdf,
  synctexForward,
  synctexInverse,
} from "../../shared/rpc";
import type { CharPosition, LanguageClient, WebModules } from "../web-contract";

/** A place in a source file, in zero-based lines and character (code point) columns. */
export interface SourceLocation {
  path: string;
  start: CharPosition;
  end: CharPosition | null;
}

/** The plugin calls previews make. */
export interface PreviewCalls {
  connectPreview(input: RpcInput<typeof connectPreview>): Promise<RpcOutput<typeof connectPreview>>;
  renderMarkdown(input: RpcInput<typeof renderMarkdown>): Promise<RpcOutput<typeof renderMarkdown>>;
  locatePdf(input: RpcInput<typeof locatePdf>): Promise<RpcOutput<typeof locatePdf>>;
  statPdf(input: RpcInput<typeof statPdf>): Promise<RpcOutput<typeof statPdf>>;
  readPdf(input: RpcInput<typeof readPdf>): Promise<RpcOutput<typeof readPdf>>;
  synctexForward(input: RpcInput<typeof synctexForward>): Promise<RpcOutput<typeof synctexForward>>;
  synctexInverse(input: RpcInput<typeof synctexInverse>): Promise<RpcOutput<typeof synctexInverse>>;
  pdfjsPart(input: RpcInput<typeof pdfjsPart>): Promise<RpcOutput<typeof pdfjsPart>>;
  pdfjsBinary(input: RpcInput<typeof pdfjsBinary>): Promise<RpcOutput<typeof pdfjsBinary>>;
}

/** What the panel gives a preview. */
export interface PreviewServices {
  /** The open file's absolute path on the daemon host. */
  filePath: string;
  /** The editor's current text, saved or not. */
  text(): string;
  /** The language server, when one is running. */
  client: LanguageClient | null;
  /** The session, for previews served through it. */
  session: { id: string; sendPreview(message: string): void } | null;
  calls: PreviewCalls;
  web: WebModules;
  /** The element to draw in; on web, a React Native `View` ref is its DOM element. */
  parent: unknown;
  theme: PluginTheme;
  invert: boolean;
  /** The preview asks the editor to show a source location. */
  jump(location: SourceLocation): void;
  openExternal(url: string): void;
  notice(message: string): void;
}

/** A running preview. */
export interface Preview {
  /** A frame from the session, for previews served through it. */
  deliver(frame: PreviewFrame): void;
  /** Shows where `position` of the open file ends up. */
  reveal(position: CharPosition): void;
  /** The editor's text changed. */
  textChanged(): void;
  /** The file was saved. */
  saved(): void;
  setInvert(invert: boolean): void;
  setTheme(theme: PluginTheme): void;
  destroy(): void;
}

/** A kind of preview: how to start one, and what it reads from the language server. */
export interface PreviewProvider {
  /** Whether it needs the language server running; a Markdown preview does not. */
  needsServer: boolean;
  start(services: PreviewServices): Promise<Preview>;
  /** The source location a server notification asks the editor to show, if it is one. */
  sourceJump(method: string, params: unknown): SourceLocation | null;
  /** Server notifications the preview uses and the editor should not see. */
  swallows(method: string): boolean;
}
