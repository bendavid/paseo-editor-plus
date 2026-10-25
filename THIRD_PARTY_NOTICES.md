# Third-party notices

Paseo bundles these packages into the plugin's client code when it builds the plugin. Their
license texts ship in `node_modules/<package>/LICENSE` after `npm ci`.

| Package                                                                                                                                                                                 | License    | Copyright                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------- |
| `@codemirror/autocomplete`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/lint`, `@codemirror/lsp-client`, `@codemirror/search`, `@codemirror/state`, `@codemirror/view` | MIT        | Marijn Haverbeke and others                     |
| `@lezer/common`, `@lezer/highlight`                                                                                                                                                     | MIT        | Marijn Haverbeke and others                     |
| `style-mod`, `w3c-keyname`, `crelt`, `@marijn/find-cluster-break`                                                                                                                       | MIT        | Marijn Haverbeke                                |
| `marked`                                                                                                                                                                                | MIT        | Christopher Jeffrey and the marked contributors |
| `codemirror-lang-typst` (its `lezer` entry; the WebAssembly parser is not used)                                                                                                         | Apache-2.0 | kxxt and contributors                           |

`client/web/semantic-tokens.ts` follows the approach of `semantic-tokens.ts` in
[Ahdeyyy/typwriter](https://github.com/Ahdeyyy/typwriter) (MIT, Copyright (c) Ahdeyyy). No code is
copied from it.

Language servers and their preview pages are not included. The plugin runs the servers installed on
the daemon host, such as tinymist (Apache-2.0, https://github.com/Myriad-Dreamin/tinymist), and shows
the preview pages they serve.
