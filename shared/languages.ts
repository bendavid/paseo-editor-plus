// The languages Editor Plus handles. Each one names its file extensions, the language server that
// runs on the daemon host, and optionally a preview. Adding a language is an entry here, its
// CodeMirror support in client/web/languages/, and, for a new kind of preview, a provider in
// client/previews/ and server/previews/.

export type PreviewKind = "tinymist";

export interface LanguageServer {
  /** The executable searched for on the daemon host. */
  binary: string;
  args: readonly string[];
  /** Shown in the status bar and settings. */
  name: string;
  homepage: string;
  /** Sent in `initialize` and answered for `workspace/configuration`. */
  options: Readonly<Record<string, unknown>>;
  /** The section name the server asks for in `workspace/configuration`. */
  configSection: string;
}

export interface LanguageProfile {
  /** Stable: names the file panel, the tab state, and the settings entry. */
  id: string;
  title: string;
  /** The LSP language identifier. */
  languageId: string;
  extensions: readonly string[];
  /** A Lucide icon name. */
  icon: string;
  server: LanguageServer;
  preview: PreviewKind | null;
  /**
   * Semantic token types the editor leaves to its own highlighting: the server's version of them
   * arrives a round trip late and lingers while typing.
   */
  plainTokenTypes: readonly string[];
}

export const LANGUAGES: readonly LanguageProfile[] = [
  {
    id: "typst",
    title: "Typst",
    languageId: "typst",
    extensions: ["typ"],
    icon: "FileCode",
    server: {
      binary: "tinymist",
      args: ["lsp"],
      name: "tinymist",
      homepage: "https://github.com/Myriad-Dreamin/tinymist",
      configSection: "tinymist",
      options: {
        // Jumps from the preview arrive as a notification the editor handles itself.
        customizedShowDocument: true,
        formatterMode: "typstyle",
        semanticTokens: "enable",
        exportPdf: "never",
      },
    },
    preview: "tinymist",
    plainTokenTypes: ["text", "comment", "punct", "delim"],
  },
];

export function languageById(id: string): LanguageProfile | null {
  return LANGUAGES.find((language) => language.id === id) ?? null;
}
