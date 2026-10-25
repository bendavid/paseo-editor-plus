# Editor Plus for Paseo

A [Paseo](https://paseo.sh) plugin that opens files in the file tab with a CodeMirror editor backed
by a language server on the daemon host, with a live preview beside it where the language has one:

- completion, hover documentation, signature help, diagnostics, formatting, rename, go to
  definition, and references;
- highlighting in two layers: a grammar in the app that colours as you type, and the server's
  semantic tokens over it;
- live previews, updated before saving and shown beside the editor, alone, or not at all; clicking
  the preview moves the cursor to the source (bringing the editor back if it was hidden), and
  clicking the source shows its place in the preview:
  - Typst: tinymist's own preview;
  - Markdown: rendered on the daemon host, as slides when the file is a
    [Marp](https://marp.app) deck (`marp: true` in its front matter);
  - LaTeX: the built PDF, linked to the source with SyncTeX (Ctrl/Cmd-click or double-click the
    PDF to go to the source);
- for Typst and LaTeX, a PDF built on every save when switched on in the settings, or with the
  toolbar's **Compile PDF**;
- spellchecking by the browser's or desktop app's checker, of prose only: text and comments in
  Typst, LaTeX, and Markdown (on by default), comments in code (off by default);
- language servers found on the daemon host, or installed by the plugin when you ask, pinned and
  verified.

| Language              | Extensions                                            | Server                                                                                                                     | Installs from           |
| --------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Typst                 | `typ`                                                 | [tinymist](https://github.com/Myriad-Dreamin/tinymist)                                                                     | GitHub release          |
| Python                | `py`, `pyi`                                           | [basedpyright](https://docs.basedpyright.com)                                                                              | npm                     |
| Rust                  | `rs`                                                  | [rust-analyzer](https://rust-analyzer.github.io)                                                                           | GitHub release          |
| Go                    | `go`                                                  | [gopls](https://go.dev/gopls)                                                                                              | `go install` (needs Go) |
| C/C++                 | `c`, `h`, `cc`, `cpp`, `cxx`, `hh`, `hpp`, `hxx`      | [clangd](https://clangd.llvm.org)                                                                                          | GitHub release          |
| JavaScript/TypeScript | `js`, `mjs`, `cjs`, `jsx`, `ts`, `mts`, `cts`, `tsx`  | [typescript-language-server](https://github.com/typescript-language-server/typescript-language-server) with TypeScript 5.9 | npm                     |
| LaTeX                 | `tex`, `sty`, `cls`, `ltx`, `bib`                     | [texlab](https://github.com/latex-lsp/texlab)                                                                              | GitHub release          |
| Markdown              | `md`, `markdown`                                      | [marksman](https://github.com/artempyanykh/marksman)                                                                       | GitHub release          |
| JSON, CSS, HTML       | `json`, `jsonc`; `css`, `scss`, `less`; `html`, `htm` | [vscode-langservers-extracted](https://github.com/hrsh7th/vscode-langservers-extracted)                                    | npm                     |

See [OVERVIEW.md](OVERVIEW.md) for what it does from a user's point of view.

Requires Paseo 0.13.0 or later. Runs in the desktop app and the web app; the iOS and Android apps
show the source read-only.

## Install

From a checkout:

```sh
npm install
paseo plugin install "$PWD"
```

From Git (Paseo runs the `build` step in paseo-plugin.json on the daemon host, which needs `npm` on
its PATH):

```sh
paseo plugin add git:bendavid/paseo-editor-plus
```

Open a file of a supported type from Files. Paseo asks how to open each extension the first time;
choose the language's panel (such as **Python**). Markdown and HTML also have Paseo's own panels,
and Paseo opens files reached from an agent's link or a search result in its own panel.

## Language servers

The plugin looks for each server in this order: the path set in **Settings › Plugins ›
editor-plus › Settings**, a copy the plugin installed, the daemon's `PATH`, your login
shell's `PATH`, and common install directories.

When none is found, the editor offers **Install…**. A confirmation shows the version, where it is
downloaded from, its size and license, and where it goes; nothing downloads before you confirm.
Installs go to `$PASEO_HOME/plugin-data/editor-plus/servers/<server>/<version>/` on the daemon
host (`~/.paseo/…` by default), the folder other Paseo plugins use for their data, with a record in
`installed.json`. Each daemon home and each host has its own copies.

- **GitHub releases** are pinned per platform with the SHA-256 GitHub records for each asset
  (`shared/server-releases.ts`, written by `scripts/update-servers.mjs`), checked after download.
  `.tar.gz` archives unpack with `tar`; `.zip` archives with the plugin's own extractor.
- **npm servers** install from the manifest and lockfile in `server/npm/<server>/` with
  `npm ci --omit=dev --ignore-scripts`, and run on the Node.js that runs the plugin (in the desktop
  app, Electron's), so they need no `node` on PATH.
- **gopls** installs with `go install golang.org/x/tools/gopls@v<version>`, which checks Go's
  checksum database.

Settings show the server in use for each language and offer the plugin's own pinned copy even when
another is found (the plugin's copy is then used instead); the editor asks only when none is found.
They update and remove the plugin's copies. Removing the plugin does not delete them (Paseo gives plugins no uninstall hook); use
**Remove** first, or delete `plugin-data/editor-plus`.

## How it works

- **One language server per tab.** Opening a tab starts the language's server on the daemon host,
  in the workspace directory, through the plugin's server code. Closing the tab stops it; a tab
  the app stops polling (closed window, lost connection) is stopped after 90 seconds.
- **The language client runs in the app.** The editor uses
  [`@codemirror/lsp-client`](https://github.com/codemirror/lsp-client). Its JSON-RPC messages travel
  through plugin calls. Plugin calls cannot push to the app, so the app keeps one call open (up to
  20 seconds, under the daemon's 30-second limit) that returns as soon as the server sends
  something. Messages to the server go out one call at a time, so they arrive in order.
- **Highlighting in two layers.** A grammar in the app colours every keystroke: CodeMirror's
  official Lezer grammars, [codemirror-lang-typst](https://github.com/kxxt/codemirror-lang-typst)
  for Typst, and the legacy stex mode for LaTeX. The server's semantic tokens arrive a round trip
  later and draw over it with the same palette; `@codemirror/lsp-client` has no semantic tokens, so
  `client/web/semantic-tokens.ts` requests full and delta tokens, maps them through edits made
  while the request was out, and leaves comments (and, for Typst, plain text) to the grammar.
- **Previews run in the panel, without opening a port.** Each kind is a provider in
  `client/previews/`; all of them reach the daemon host only through plugin calls, so they work
  over SSH, the relay, or a LAN.
  - **Typst:** tinymist serves its preview page and a WebSocket on `127.0.0.1`. The plugin server
    fetches the page and holds the WebSocket; the panel writes the page into an iframe and replaces
    its `WebSocket` with one that travels through plugin calls. The server only connects to ports
    the session's language server announced.
  - **Markdown:** the plugin server renders the editor's text with markdown-it, or Marp for a
    deck, with raw HTML off, local images inlined, and `data-source-line` on block elements. The
    panel shows it in a shadow root (after removing anything executable) and uses the line marks
    to scroll with the editor and to jump back.
  - **LaTeX:** the panel shows the PDF beside the root document (`% !TEX root = …` names it for
    an included file) with PDF.js, which the plugin server embeds and serves as the pdfjs-viewer
    plugin does. It checks the PDF's modification time every 1.5 seconds, reads a new build in
    chunks, and swaps it in keeping the reader's place. `synctex view` and `synctex edit` on the
    daemon host map lines to PDF boxes and back.
- **Building PDFs.** Compile to PDF on save sets tinymist's `exportPdf` to `onSave`, and texlab's
  `build.onSave` with latexmk (`-pdf -interaction=nonstopmode -synctex=1`). The editor tells the
  server when it saves (`textDocument/didSave`), and sends settings both ways servers read them:
  in answer to `workspace/configuration` and with `workspace/didChangeConfiguration`. **Compile
  PDF** runs `tinymist.exportPdf` or texlab's `textDocument/build`.
- **Spelling is checked by the browser.** CodeMirror turns it off; `client/web/spelling.ts` turns
  it on for the editor and marks everything that isn't prose `spellcheck="false"`, from the
  grammar's tree: Typst keeps its `Text` nodes, Markdown and LaTeX keep what the grammar doesn't
  highlight as code, and code keeps comments. Chromium skips marked spans inside a checked line
  but ignores checked spans inside an unchecked editor, so the marks exclude code rather than
  include text. stex reads the arguments of commands such as `\input` and `\label` as text, so
  the LaTeX profile lists them. Suggestions and **Add to Dictionary** come from the browser's or
  the desktop app's context menu.
- **Edits reach the server before saving.** The editor sends changes 120 ms after typing; a preview
  recompiles from them. The file is saved 500 ms after the last edit, and a change on disk while
  edits are unsaved offers Reload or Overwrite.

## Adding a language

1. Add a profile to `shared/languages.ts`: extensions and their LSP language ids, the server's
   binary, arguments, settings, and which semantic token types to leave to the grammar.
2. Add its grammar to `client/web/languages/`. Without one, the editor shows plain text and relies
   on semantic tokens.
3. To offer an install, add the server to `scripts/update-servers.mjs` (GitHub release) and run it,
   or to `shared/servers.ts` with a lockfile in `server/npm/<server>/` (npm) or a Go module.
4. For a preview, add a provider to `client/previews/`: start it, show the cursor's place, follow
   edits or saves, and report jumps back to the source. A preview served on a port also needs
   `server/previews/` to recognise the port it announces.
5. For building a PDF, add `compile` to the profile: the server settings for building on save, and
   the command or request that builds now.
6. Set `spellcheck` in the profile (on for prose languages) and `spelling` in its grammar entry:
   which parts of the file are prose.

## Limits

- Not available in the iOS and Android apps: plugins there cannot run a DOM editor or a web page
  ([#5834](https://github.com/getpaseo/paseo/discussions/5834)).
- Go to definition and preview clicks that land in another file show a message instead of opening
  it: plugins cannot open a file tab at a line
  ([#7585](https://github.com/getpaseo/paseo/discussions/7585)).
- Each update reaches the app one round trip after the server sends it, because plugin calls
  cannot push ([#7795](https://github.com/getpaseo/paseo/discussions/7795)).
- The client bundle is about 2 MB: Paseo does not minify plugin bundles, and the native apps load
  (but never run) the editor and its grammars. Loading them from the plugin server on web only
  would shrink it.
- tinymist's preview protocol is internal to tinymist; tested with tinymist 0.15.10. The Typst
  preview treats the open file as the document entry.
- Building LaTeX needs latexmk and a TeX distribution on the daemon host, and SyncTeX linking needs
  its `synctex` tool. The PDF is expected beside the root document.
- The spellchecker is the browser's: its languages and dictionary are the browser's or the
  desktop app's, and it underlines without offering a list of mistakes. LaTeX arguments of
  commands not in the profile's list are checked as text.
- The Markdown preview is read-only (no rich editing), and Marp decks show as a scrolling list of
  slides, without presenter mode.

## Develop

```sh
npm install                                # also embeds PDF.js into server/generated/
npm run typecheck
npm test                                   # the session test runs when tinymist is on PATH
EDITOR_PLUS_NETWORK_TESTS=1 npx vitest run test/installer.network.test.ts test/servers.network.test.ts
npm run format                             # Prettier
node scripts/update-servers.mjs            # after changing a pinned release
paseo plugin install "$PWD"
paseo plugin reload editor-plus            # after changes
```

The network tests download every server (several hundred megabytes) into a temporary
`PASEO_HOME`, run each the way the plugin does, and check it answers an editor session.

`test/plugin-build.test.ts` repeats the dependency walk Paseo's plugin compiler does over type
declarations, which fails on `declare module` names and outdated paths inside dependencies'
declarations; `paths` in tsconfig.json maps the ones Marp brings in.

`client/web/` is the only code that touches the DOM; it is type-checked with `tsconfig.web.json`,
and the panel reaches it through `client/web-contract.ts`. The rest of the client is type-checked
without the DOM library and must stay safe to evaluate in the native apps. `test/bundle.test.ts`
compiles the client with Paseo's compiler options, rejects `import()` syntax (Hermes cannot parse
it), and evaluates the bundle without a DOM. Server code is type-checked with
`tsconfig.server.json`.

## Credits

- The language servers listed above, run as separate programs and never bundled.
- [tinymist](https://github.com/Myriad-Dreamin/tinymist) by Myriad-Dreamin and contributors for
  Typst's language server and preview; its VS Code extension showed how to drive the preview.
- [CodeMirror](https://codemirror.net), its language packages, and
  [`@codemirror/lsp-client`](https://github.com/codemirror/lsp-client) by Marijn Haverbeke and
  contributors; [codemirror-lang-typst](https://github.com/kxxt/codemirror-lang-typst) by kxxt;
  [PDF.js](https://github.com/mozilla/pdf.js) by Mozilla; [Marp](https://marp.app) and
  [markdown-it](https://github.com/markdown-it/markdown-it). See
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- The semantic tokens layer follows the approach of
  [Ahdeyyy/typwriter](https://github.com/Ahdeyyy/typwriter)'s `semantic-tokens.ts` (MIT).
- Paseo's [`markdown-panel`](https://github.com/getpaseo/paseo/tree/main/plugin-examples/markdown-panel)
  example is the starting point for the editor panel's load, save, and conflict handling.

## License

MIT. See [LICENSE](LICENSE).
