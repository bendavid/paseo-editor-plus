# Editor Plus for Paseo

A [Paseo](https://paseo.sh) plugin that opens files in the file tab with a CodeMirror editor backed
by a language server on the daemon host, with a live preview beside it where the language has one.
The first language is Typst, with [tinymist](https://github.com/Myriad-Dreamin/tinymist):

- completion, hover documentation, signature help, diagnostics, formatting, rename, go to
  definition, and references;
- highlighting in two layers: a local parser that colours as you type, and tinymist's semantic
  tokens over it;
- tinymist's live preview, updated before saving; clicking the preview moves the cursor to the
  source, and clicking the source scrolls the preview.

See [OVERVIEW.md](OVERVIEW.md) for what it does from a user's point of view.

Requires Paseo 0.13.0 or later and each language's server on the daemon host. Runs in the desktop
app and the web app; the iOS and Android apps show the source read-only.

## Install

Install the language servers you need on the machine that runs the Paseo daemon (for Typst,
tinymist from its [releases](https://github.com/Myriad-Dreamin/tinymist/releases), cargo, or your
package manager). The plugin finds them on the daemon's `PATH`, your login shell's `PATH`, or
common install directories; otherwise set a path in **Settings › Plugins › editor-plus ›
Language servers**.

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

Open a file of a supported type from Files. If Paseo asks how to open it, choose the language's
panel (for `.typ` files, **Typst**).

## How it works

- **One language server per tab.** Opening a tab starts the language's server on the daemon host,
  in the workspace directory, through the plugin's server code. Closing the tab stops it; a tab
  the app stops polling (closed window, lost connection) is stopped after 90 seconds.
- **The language client runs in the app.** The editor uses
  [`@codemirror/lsp-client`](https://github.com/codemirror/lsp-client). Its JSON-RPC messages travel
  through plugin calls. Plugin calls cannot push to the app, so the app keeps one call open (up to
  20 seconds, under the daemon's 30-second limit) that returns as soon as the server sends
  something. Messages to the server go out one call at a time, so they arrive in order.
- **Highlighting in two layers.** A grammar in the app colours every keystroke (for Typst,
  [codemirror-lang-typst](https://github.com/kxxt/codemirror-lang-typst)'s Lezer parser, which
  follows Typst's own syntax tree). The server's semantic tokens arrive a round trip later and draw
  over it with the same palette; `@codemirror/lsp-client` has no semantic tokens, so
  `client/web/semantic-tokens.ts` requests full and delta tokens, maps them through edits made
  while the request was out, and leaves token types such as plain text and comments to the
  grammar. Without a server the grammar alone highlights, and the language's own completions fill
  in.
- **Previews run in the panel, without opening a port.** A preview provider starts a preview that
  serves a page and a WebSocket on `127.0.0.1` on the daemon host (tinymist's starts through its
  language server). The plugin server fetches the page and holds the WebSocket. The panel writes
  the page into an iframe and replaces its `WebSocket` with one that travels through plugin calls.
  So a preview works wherever the app reaches the daemon — over SSH, the relay, or a LAN — and the
  browser never connects to the preview server directly. The server only connects to ports the
  session's language server announced.
- **Edits reach the server before saving.** The editor sends changes 120 ms after typing; a preview
  recompiles from them. The file is saved 500 ms after the last edit, and a change on disk while
  edits are unsaved offers Reload or Overwrite.

## Adding a language

1. Add a profile to `shared/languages.ts`: extensions, the server's binary, arguments, settings,
   and which semantic token types to leave to the grammar.
2. Add its CodeMirror support to `client/web/languages/` (a Lezer parser or legacy mode, plus any
   extra highlight tags). Without one, the editor shows plain text and relies on semantic tokens.
3. For a preview, add a provider to `client/previews/` (how to start and stop it, scroll it to the
   cursor, and read its jumps back to the source) and to `server/previews/` (how to recognise the
   port it announces).

Each language registers its own file panel, so Paseo's **Open with** names the language. Prefer
languages Paseo's own editor does not cover well; for the others, Paseo asks once which panel to
use.

## Limits

- Not available in the iOS and Android apps: plugins there cannot run a DOM editor or a web page
  ([#5834](https://github.com/getpaseo/paseo/discussions/5834)).
- Go to definition and preview clicks that land in another file show a message instead of opening
  it: plugins cannot open a file tab at a line
  ([#7585](https://github.com/getpaseo/paseo/discussions/7585)).
- Each update reaches the app one round trip after the server sends it, because plugin calls
  cannot push ([#7795](https://github.com/getpaseo/paseo/discussions/7795)). Binary preview frames
  are base64-encoded, which adds about a third.
- tinymist's preview protocol is internal to tinymist. The plugin was tested with tinymist 0.15.10.
- The Typst preview shows the open file as the document entry. A chapter included from a main file
  is previewed on its own.

## Develop

```sh
npm install
npm run typecheck
npm test               # the session test runs when tinymist is on PATH
npm run format         # Prettier
paseo plugin install "$PWD"
paseo plugin reload editor-plus   # after changes
```

`client/web/` is the only code that touches the DOM; it is type-checked with `tsconfig.web.json`,
and the panel reaches it through `client/web-contract.ts`. The rest of the client is type-checked
without the DOM library and must stay safe to evaluate in the native apps. `test/bundle.test.ts`
compiles the client with Paseo's compiler options, rejects `import()` syntax (Hermes cannot parse
it), and evaluates the bundle without a DOM. Server code is type-checked with
`tsconfig.server.json`.

## Credits

- [tinymist](https://github.com/Myriad-Dreamin/tinymist) by Myriad-Dreamin and contributors provides
  Typst's language server and preview; its VS Code extension showed how to drive the preview from
  an editor. Nothing from tinymist is bundled: the preview page comes from your installed tinymist.
- [CodeMirror](https://codemirror.net) and
  [`@codemirror/lsp-client`](https://github.com/codemirror/lsp-client) by Marijn Haverbeke;
  [codemirror-lang-typst](https://github.com/kxxt/codemirror-lang-typst) by kxxt for the Typst
  parser. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- The semantic tokens layer follows the approach of
  [Ahdeyyy/typwriter](https://github.com/Ahdeyyy/typwriter)'s `semantic-tokens.ts` (MIT).
- Paseo's [`markdown-panel`](https://github.com/getpaseo/paseo/tree/main/plugin-examples/markdown-panel)
  example is the starting point for the editor panel's load, save, and conflict handling.

## License

MIT. See [LICENSE](LICENSE).
