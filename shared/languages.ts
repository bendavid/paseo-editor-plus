// The languages Editor Plus handles. Each one names its file extensions, the language server that
// runs on the daemon host, and optionally a preview. Adding a language is an entry here, its
// CodeMirror support in client/web/languages/, its server in shared/servers.ts (to offer an
// install), and, for a new kind of preview, a provider in client/previews/ and server/previews/.

export type PreviewKind = "tinymist" | "markdown" | "latex-pdf";

export interface LanguageServer {
  /** The executable searched for on the daemon host. */
  binary: string;
  /** The catalog entry (shared/servers.ts) that installs it; several languages can share one. */
  package: string;
  args: readonly string[];
  /** Shown in the status bar and settings. */
  name: string;
  homepage: string;
  /** Sent in `initialize` and answered for `workspace/configuration`. */
  options: Readonly<Record<string, unknown>>;
  /** The section name the server asks for in `workspace/configuration`. */
  configSection: string;
}

export interface CompileSupport {
  /** Server settings that turn building on save on or off; merged into `server.options`. */
  onSave(enabled: boolean): Record<string, unknown>;
  /** How to build now: a workspace command with the file's path, or a request with its URI. */
  now: { kind: "command"; command: string } | { kind: "request"; method: string };
}

/** Server settings with building on save switched as the user chose. */
export function serverOptions(
  language: LanguageProfile,
  compileOnSave: boolean,
): Record<string, unknown> {
  return { ...language.server.options, ...(language.compile?.onSave(compileOnSave) ?? {}) };
}

export interface LanguageProfile {
  /** Stable: names the file panel, the tab state, and the settings entry. */
  id: string;
  title: string;
  /** File extensions, lowercase without the dot, and the LSP language identifier of each. */
  extensions: Readonly<Record<string, string>>;
  /** A Lucide icon name. */
  icon: string;
  server: LanguageServer;
  preview: PreviewKind | null;
  /** Building a PDF, for languages that make one: on every save, or on demand. */
  compile: CompileSupport | null;
  /**
   * Semantic token types the editor leaves to its own highlighting: the server's version of them
   * arrives a round trip late and lingers while typing.
   */
  plainTokenTypes: readonly string[];
  /** Whether the editor checks spelling until the user chooses: on for prose, off for code. */
  spellcheck: boolean;
}

/** Comments are the grammar's: a server's comment tokens linger over text being uncommented. */
const CODE_PLAIN = ["comment"] as const;

const VSCODE_SERVERS = {
  package: "vscode-langservers-extracted",
  homepage: "https://github.com/hrsh7th/vscode-langservers-extracted",
};

export const LANGUAGES: readonly LanguageProfile[] = [
  {
    id: "typst",
    title: "Typst",
    extensions: { typ: "typst" },
    icon: "FileCode",
    server: {
      binary: "tinymist",
      package: "tinymist",
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
    compile: {
      onSave: (enabled) => ({ exportPdf: enabled ? "onSave" : "never" }),
      now: { kind: "command", command: "tinymist.exportPdf" },
    },
    plainTokenTypes: ["text", "comment", "punct", "delim"],
    spellcheck: true,
  },
  {
    id: "python",
    title: "Python",
    extensions: { py: "python", pyi: "python" },
    icon: "FileCode",
    server: {
      binary: "basedpyright-langserver",
      package: "basedpyright",
      args: ["--stdio"],
      name: "basedpyright",
      homepage: "https://docs.basedpyright.com",
      configSection: "basedpyright",
      options: {},
    },
    preview: null,
    compile: null,
    plainTokenTypes: CODE_PLAIN,
    spellcheck: false,
  },
  {
    id: "rust",
    title: "Rust",
    extensions: { rs: "rust" },
    icon: "FileCode",
    server: {
      binary: "rust-analyzer",
      package: "rust-analyzer",
      args: [],
      name: "rust-analyzer",
      homepage: "https://rust-analyzer.github.io",
      configSection: "rust-analyzer",
      options: {},
    },
    preview: null,
    compile: null,
    plainTokenTypes: CODE_PLAIN,
    spellcheck: false,
  },
  {
    id: "go",
    title: "Go",
    extensions: { go: "go" },
    icon: "FileCode",
    server: {
      binary: "gopls",
      package: "gopls",
      args: [],
      name: "gopls",
      homepage: "https://go.dev/gopls",
      configSection: "gopls",
      // gopls sends semantic tokens only when asked to.
      options: { semanticTokens: true },
    },
    preview: null,
    compile: null,
    plainTokenTypes: CODE_PLAIN,
    spellcheck: false,
  },
  {
    id: "cpp",
    title: "C/C++",
    extensions: {
      c: "c",
      h: "c",
      cc: "cpp",
      cpp: "cpp",
      cxx: "cpp",
      hh: "cpp",
      hpp: "cpp",
      hxx: "cpp",
    },
    icon: "FileCode",
    server: {
      binary: "clangd",
      package: "clangd",
      args: [],
      name: "clangd",
      homepage: "https://clangd.llvm.org",
      configSection: "clangd",
      options: {},
    },
    preview: null,
    compile: null,
    plainTokenTypes: CODE_PLAIN,
    spellcheck: false,
  },
  {
    id: "javascript",
    title: "JavaScript/TypeScript",
    extensions: {
      js: "javascript",
      mjs: "javascript",
      cjs: "javascript",
      jsx: "javascriptreact",
      ts: "typescript",
      mts: "typescript",
      cts: "typescript",
      tsx: "typescriptreact",
    },
    icon: "FileCode",
    server: {
      binary: "typescript-language-server",
      package: "typescript-language-server",
      args: ["--stdio"],
      name: "typescript-language-server",
      homepage: "https://github.com/typescript-language-server/typescript-language-server",
      configSection: "typescript",
      options: {},
    },
    preview: null,
    compile: null,
    plainTokenTypes: CODE_PLAIN,
    spellcheck: false,
  },
  {
    id: "latex",
    title: "LaTeX",
    extensions: { tex: "latex", sty: "latex", cls: "latex", ltx: "latex", bib: "bibtex" },
    icon: "FileCode",
    server: {
      binary: "texlab",
      package: "texlab",
      args: [],
      name: "texlab",
      homepage: "https://github.com/latex-lsp/texlab",
      configSection: "texlab",
      options: {},
    },
    preview: "latex-pdf",
    compile: {
      // latexmk beside the root document, with SyncTeX for the preview's linking.
      onSave: (enabled) => ({
        build: {
          onSave: enabled,
          executable: "latexmk",
          args: ["-pdf", "-interaction=nonstopmode", "-synctex=1", "%f"],
          forwardSearchAfter: false,
        },
      }),
      now: { kind: "request", method: "textDocument/build" },
    },
    plainTokenTypes: CODE_PLAIN,
    spellcheck: true,
  },
  {
    id: "markdown",
    title: "Markdown",
    extensions: { md: "markdown", markdown: "markdown" },
    icon: "FileText",
    server: {
      binary: "marksman",
      package: "marksman",
      args: ["server"],
      name: "marksman",
      homepage: "https://github.com/artempyanykh/marksman",
      configSection: "marksman",
      options: {},
    },
    preview: "markdown",
    compile: null,
    plainTokenTypes: CODE_PLAIN,
    spellcheck: true,
  },
  {
    id: "json",
    title: "JSON",
    extensions: { json: "json", jsonc: "jsonc" },
    icon: "FileJson",
    server: {
      ...VSCODE_SERVERS,
      binary: "vscode-json-language-server",
      args: ["--stdio"],
      name: "vscode-json-language-server",
      configSection: "json",
      options: { provideFormatter: true },
    },
    preview: null,
    compile: null,
    plainTokenTypes: CODE_PLAIN,
    spellcheck: false,
  },
  {
    id: "css",
    title: "CSS",
    extensions: { css: "css", scss: "scss", less: "less" },
    icon: "FileCode",
    server: {
      ...VSCODE_SERVERS,
      binary: "vscode-css-language-server",
      args: ["--stdio"],
      name: "vscode-css-language-server",
      configSection: "css",
      options: { provideFormatter: true },
    },
    preview: null,
    compile: null,
    plainTokenTypes: CODE_PLAIN,
    spellcheck: false,
  },
  {
    id: "html",
    title: "HTML",
    extensions: { html: "html", htm: "html" },
    icon: "FileCode",
    server: {
      ...VSCODE_SERVERS,
      binary: "vscode-html-language-server",
      args: ["--stdio"],
      name: "vscode-html-language-server",
      configSection: "html",
      options: { provideFormatter: true, embeddedLanguages: { css: true, javascript: true } },
    },
    preview: null,
    compile: null,
    plainTokenTypes: CODE_PLAIN,
    spellcheck: false,
  },
];

export function languageById(id: string): LanguageProfile | null {
  return LANGUAGES.find((language) => language.id === id) ?? null;
}

/** The LSP language identifier for a file, from its extension. */
export function languageIdFor(language: LanguageProfile, extension: string): string {
  return language.extensions[extension.toLowerCase()] ?? Object.values(language.extensions)[0];
}
