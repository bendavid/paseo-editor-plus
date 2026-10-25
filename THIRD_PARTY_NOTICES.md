# Third-party notices

Paseo bundles these packages into the plugin's client code when it builds the plugin. Their
license texts ship in `node_modules/<package>/LICENSE` after `npm ci`.

| Package                                                                                                                                                                                                                                                                                                                                 | License    | Copyright                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------- |
| `@codemirror/autocomplete`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/lint`, `@codemirror/lsp-client`, `@codemirror/search`, `@codemirror/state`, `@codemirror/view`                                                                                                                                                 | MIT        | Marijn Haverbeke and others                     |
| `@codemirror/lang-cpp`, `@codemirror/lang-css`, `@codemirror/lang-go`, `@codemirror/lang-html`, `@codemirror/lang-javascript`, `@codemirror/lang-json`, `@codemirror/lang-less`, `@codemirror/lang-markdown`, `@codemirror/lang-python`, `@codemirror/lang-rust`, `@codemirror/lang-sass`, `@codemirror/legacy-modes` (its `stex` mode) | MIT        | Marijn Haverbeke and others                     |
| `@lezer/common`, `@lezer/highlight`, `@lezer/lr`, and the `@lezer` grammars for C++, CSS, Go, HTML, JavaScript, JSON, Markdown, Python, Rust, and Sass                                                                                                                                                                                  | MIT        | Marijn Haverbeke and others                     |
| `style-mod`, `w3c-keyname`, `crelt`, `@marijn/find-cluster-break`                                                                                                                                                                                                                                                                       | MIT        | Marijn Haverbeke                                |
| `marked`                                                                                                                                                                                                                                                                                                                                | MIT        | Christopher Jeffrey and the marked contributors |
| `codemirror-lang-typst` (its `lezer` entry; the WebAssembly parser is not used)                                                                                                                                                                                                                                                         | Apache-2.0 | kxxt and contributors                           |

The plugin downloads these on first use into the user's Paseo data folder (see the README's
Downloads); their license texts are in each package's folder there:

| Package                                                                                   | License                              | Copyright                             |
| ----------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------- |
| `pdfjs-dist` (for the LaTeX preview; its files are sent to the app on web)                | Apache-2.0                           | Mozilla Foundation                    |
| `cspell-lib` and the `@cspell` packages it depends on, including its bundled dictionaries | MIT, except as below                 | Street Side Software and contributors |
| `@cspell/dict-en-common-misspellings`                                                     | CC BY-SA 4.0                         | its authors                           |
| `@cspell/dict-django`                                                                     | WTFPL                                | its authors                           |
| cspell's other dependencies (`yaml`, `ini`, `smol-toml`, `esprima`, and others)           | MIT, ISC, BSD-2-Clause, BSD-3-Clause | their authors                         |

The plugin's server code renders Markdown on the daemon host with:

| Package                                                                        | License      | Copyright                                      |
| ------------------------------------------------------------------------------ | ------------ | ---------------------------------------------- |
| `@marp-team/marp-core`, `@marp-team/marpit`, `@marp-team/marpit-svg-polyfill`  | MIT          | Marp team                                      |
| `markdown-it` and its plugins                                                  | MIT          | Vitaly Puzrin, Alex Kocharin, and contributors |
| `highlight.js` (through Marp)                                                  | BSD-3-Clause | Ivan Sagalaev and contributors                 |
| `mathjax-full` (through Marp)                                                  | Apache-2.0   | The MathJax Consortium                         |
| `katex`, `js-yaml`, `postcss`, `postcss-selector-parser`, `xss` (through Marp) | MIT          | their authors                                  |

`client/web/semantic-tokens.ts` follows the approach of `semantic-tokens.ts` in
[Ahdeyyy/typwriter](https://github.com/Ahdeyyy/typwriter) (MIT, Copyright (c) Ahdeyyy). No code is
copied from it.

Language servers and their preview pages are not included. The plugin runs servers installed on
the daemon host, such as tinymist (Apache-2.0, https://github.com/Myriad-Dreamin/tinymist), and shows
the preview pages they serve. When asked, it installs pinned versions from their publishers into the
user's Paseo data folder; each server keeps its own license, shown before it is installed:
tinymist (Apache-2.0), basedpyright (MIT), rust-analyzer (MIT OR Apache-2.0), gopls (BSD-3-Clause),
clangd (Apache-2.0 WITH LLVM-exception), typescript-language-server (Apache-2.0) with TypeScript
(Apache-2.0), texlab (MIT), marksman (MIT), and vscode-langservers-extracted (MIT).
