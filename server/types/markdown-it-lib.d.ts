// Stands in for markdown-it 12's "markdown-it/lib" module, which markdown-it-front-matter's
// declarations (reached through Marp) still name. Only Paseo's plugin compiler reads it; see the
// paths in tsconfig.json.
declare const MarkdownIt: any;
export = MarkdownIt;
