# Typst editor for Paseo (tinymist)

A [Paseo](https://paseo.sh) plugin that opens `.typ` files in the file tab with a CodeMirror
editor backed by [tinymist](https://github.com/Myriad-Dreamin/tinymist): completion, hover
documentation, signature help, diagnostics, formatting, rename, and tinymist's live preview beside
the editor. Clicking the preview moves the cursor to the source; clicking the source scrolls the
preview to it. See [OVERVIEW.md](OVERVIEW.md) for what it does from a user's point of view.

Requires Paseo 0.13.0 or later and tinymist on the daemon host. Runs in the desktop app and the web
app; the iOS and Android apps show the source read-only.

## Install

tinymist must be installed on the machine that runs the Paseo daemon (from its
[releases](https://github.com/Myriad-Dreamin/tinymist/releases), cargo, or your package manager).
The plugin finds it on the daemon's `PATH`, your login shell's `PATH`, or common install
directories; otherwise set its path in **Settings › Plugins › typst-tinymist › Typst**.

From a checkout:

```sh
npm install
paseo plugin install "$PWD"
```

From Git (Paseo runs the `build` step in paseo-plugin.json on the daemon host, which needs `npm` on
its PATH):

```sh
paseo plugin add git:bendavid/paseo-typst-tinymist
```

Open a `.typ` file from Files. If Paseo asks how to open it, choose **Typst**.

## How it works

- **One tinymist per tab.** Opening a tab starts `tinymist lsp` on the daemon host, in the
  workspace directory, through the plugin's server code. Closing the tab stops it; a tab the app
  stops polling (closed window, lost connection) is stopped after 90 seconds.
- **The language client runs in the app.** The editor uses
  [`@codemirror/lsp-client`](https://github.com/codemirror/lsp-client). Its JSON-RPC messages travel
  through plugin calls. Plugin calls cannot push to the app, so the app keeps one call open (up to
  20 seconds, under the daemon's 30-second limit) that returns as soon as tinymist sends something.
  Messages to tinymist go out one call at a time, so they arrive in order.
- **The preview runs in the panel, without opening a port.** tinymist's language server starts the
  preview (`tinymist.doStartPreview`) and serves its page and WebSocket on `127.0.0.1` on the daemon
  host. The plugin server fetches the page and holds the WebSocket. The panel writes the page into
  an iframe and replaces its `WebSocket` with one that travels through plugin calls. So the preview
  works wherever the app reaches the daemon — over SSH, the relay, or a LAN — and the browser never
  connects to tinymist directly.
- **Jumps between source and preview** use tinymist's own preview protocol: cursor clicks send
  `tinymist.scrollPreview`; clicks in the preview come back as `tinymist/preview/scrollSource`.
  The plugin converts columns between UTF-16 (CodeMirror, LSP) and characters (tinymist's preview).
- **Edits reach the preview before saving.** The editor sends changes to tinymist 120 ms after
  typing; tinymist compiles from memory. The file is saved 500 ms after the last edit, and a change
  on disk while edits are unsaved offers Reload or Overwrite.

## Limits

- Not available in the iOS and Android apps: plugins there cannot run a DOM editor or a web page
  ([#5834](https://github.com/getpaseo/paseo/discussions/5834)).
- Go to definition and preview clicks that land in another file show a message instead of opening
  it: plugins cannot open a file tab at a line
  ([#7585](https://github.com/getpaseo/paseo/discussions/7585)).
- Each update reaches the app one round trip after tinymist sends it, because plugin calls cannot
  push ([#7795](https://github.com/getpaseo/paseo/discussions/7795)). Binary preview frames are
  base64-encoded, which adds about a third.
- The preview's protocol is internal to tinymist. The plugin was tested with tinymist 0.15.10.
- The preview shows the open file as the document entry. A chapter included from a main file is
  previewed on its own.

## Develop

```sh
npm install
npm run typecheck
npm test               # the session test runs when tinymist is on PATH
npm run format         # Prettier
paseo plugin install "$PWD"
paseo plugin reload typst-tinymist   # after changes
```

`client/web/` is the only code that touches the DOM; it is type-checked with `tsconfig.web.json`,
and the panel reaches it through `client/web-contract.ts`. The rest of the client is type-checked
without the DOM library and must stay safe to evaluate in the native apps. `test/bundle.test.ts`
compiles the client with Paseo's compiler options, rejects `import()` syntax (Hermes cannot parse
it), and evaluates the bundle without a DOM.

## Credits

- [tinymist](https://github.com/Myriad-Dreamin/tinymist) by Myriad-Dreamin and contributors provides
  the language server and the preview; its VS Code extension showed how to drive the preview from
  an editor. Nothing from tinymist is bundled: the preview page comes from your installed tinymist.
- [CodeMirror](https://codemirror.net) and
  [`@codemirror/lsp-client`](https://github.com/codemirror/lsp-client) by Marijn Haverbeke. See
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Paseo's [`markdown-panel`](https://github.com/getpaseo/paseo/tree/main/plugin-examples/markdown-panel)
  example is the starting point for the editor panel's load, save, and conflict handling.

## License

MIT. See [LICENSE](LICENSE).
