import { Language, LanguageSupport, languageDataProp } from "@codemirror/language";
import {
  TypstLezerParser,
  typstLezerFolding,
  typstLezerFoldService,
  typstLezerHighlighting,
  typstLezerIndentation,
  typstLezerIndentService,
  typstLezerLanguageData,
  typstLezerListKeymap,
  typstTags,
} from "codemirror-lang-typst/lezer";
import type { EditorLanguage } from "./index";

// Typst through codemirror-lang-typst's native Lezer parser (no WebAssembly), which follows the
// node kinds of Typst's own `typst-syntax` crate. This is typst_lezer() without its syntax linter
// and colour styles: tinymist reports diagnostics, and the editor's palette colours the tree. The
// package's completions (built-ins, local bindings, labels) stay as language data and fill in
// while tinymist is not running; with tinymist, the editor uses tinymist's completions only.

function typstSupport(): LanguageSupport {
  const parser = new TypstLezerParser(
    languageDataProp.add((type) => (type.isTop ? typstLezerLanguageData : undefined)),
    typstLezerHighlighting,
    typstLezerIndentation,
    typstLezerFolding,
  );
  return new LanguageSupport(new Language(typstLezerLanguageData, parser, [], "typst"), [
    typstLezerIndentService,
    typstLezerListKeymap,
    typstLezerFoldService,
  ]);
}

export const typst: EditorLanguage = {
  support: () => typstSupport(),
  tags: [
    { tag: typstTags.listMarker, color: "keyword" },
    { tag: typstTags.mathDelimiter, color: "math" },
    { tag: typstTags.interpolated, color: "fn" },
  ],
};
