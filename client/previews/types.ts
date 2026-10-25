import type { CharPosition } from "../web-contract";

/** What a preview needs from the editor's language server connection. */
export interface PreviewContext {
  /** Runs a `workspace/executeCommand` on the language server. */
  command(name: string, args: unknown[]): Promise<unknown>;
  /** The open file's absolute path on the daemon host. */
  filePath: string;
}

/** A place in a source file, in zero-based lines and character (code point) columns. */
export interface SourceLocation {
  path: string;
  start: CharPosition;
  end: CharPosition | null;
}

/**
 * A live preview served by a process on the daemon host as a web page with a WebSocket back to
 * its server. The panel shows the page in an iframe and carries the WebSocket through plugin
 * calls, so a provider only describes how to start it and how to link it to the source.
 */
export interface PreviewProvider {
  /** A CSS selector for the page's rendered document, which the invert button recolours. */
  invertTarget: string;
  /** Starts a preview of the open file; resolves with the port of its page on 127.0.0.1. */
  start(context: PreviewContext): Promise<{ task: string; port: number }>;
  stop(context: PreviewContext, task: string): Promise<void>;
  /** Scrolls the preview to show `position` in the open file. */
  reveal(context: PreviewContext, task: string, position: CharPosition): Promise<void>;
  /** The source location a server notification asks the editor to show, if it is one. */
  sourceJump(method: string, params: unknown): SourceLocation | null;
  /** Server notifications the preview uses and the editor should not see. */
  swallows(method: string): boolean;
}
