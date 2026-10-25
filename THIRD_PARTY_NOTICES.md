# Third-party notices

Paseo bundles these packages into the plugin's client code when it builds the plugin. All are MIT
licensed; their license texts ship in `node_modules/<package>/LICENSE` after `npm ci`.

| Package                                                                                                                                                                                 | Copyright                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `@codemirror/autocomplete`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/lint`, `@codemirror/lsp-client`, `@codemirror/search`, `@codemirror/state`, `@codemirror/view` | Marijn Haverbeke and others                     |
| `@lezer/common`, `@lezer/highlight`                                                                                                                                                     | Marijn Haverbeke and others                     |
| `style-mod`, `w3c-keyname`, `crelt`, `@marijn/find-cluster-break`                                                                                                                       | Marijn Haverbeke                                |
| `marked`                                                                                                                                                                                | Christopher Jeffrey and the marked contributors |

tinymist and its preview page are not included. The plugin runs the tinymist installed on the
daemon host (Apache-2.0, https://github.com/Myriad-Dreamin/tinymist) and shows the preview page that
tinymist serves.
