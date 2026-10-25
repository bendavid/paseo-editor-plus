import { type LanguageSupport, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { editorLanguage } from "../client/web/languages";
import { uncheckedRanges } from "../client/web/spelling";

/** The words the spellchecker reads and skips in `source`, parsed as `language`. */
function split(language: string, extension: string, source: string) {
  const editor = editorLanguage(language);
  const state = EditorState.create({ doc: source, extensions: [editor.support(extension)] });
  const tree = syntaxTree(state);
  const skipped = uncheckedRanges(tree, state.doc, editor.spelling, 0, source.length);
  const words = (from: number, to: number) => source.slice(from, to).match(/\p{L}+/gu) ?? [];
  const unchecked = skipped.flatMap((range) => words(range.from, range.to));
  const checked: string[] = [];
  let pos = 0;
  for (const range of [...skipped, { from: source.length, to: source.length }]) {
    checked.push(...words(pos, range.from));
    pos = Math.max(pos, range.to);
  }
  return { checked, unchecked };
}

describe("spelling", () => {
  it("reads Typst text and comments, not code, math, raw, labels, or references", () => {
    const { checked, unchecked } = split(
      "typst",
      "typ",
      [
        '#set text(lang: "en")',
        "= Heading wrd",
        "Some txt with $x + alpha$ and #name, `rawzz`, @refzz <lblzz>.",
        "#figure(caption: [A captn])[]",
        "// A coment",
        "Don't stop",
      ].join("\n"),
    );
    expect(checked).toEqual(
      expect.arrayContaining(["Heading", "wrd", "txt", "captn", "coment", "Don", "t", "stop"]),
    );
    for (const word of [
      "set",
      "text",
      "lang",
      "en",
      "alpha",
      "name",
      "rawzz",
      "refzz",
      "lblzz",
      "figure",
      "caption",
    ]) {
      expect(checked).not.toContain(word);
    }
    expect(unchecked).toEqual(expect.arrayContaining(["alpha", "rawzz", "refzz", "lblzz"]));
  });

  it("reads Markdown prose, not code, URLs, or front matter", () => {
    const { checked } = split(
      "markdown",
      "md",
      [
        "---",
        "marp: true",
        "theme: gaia",
        "---",
        "# A headng",
        "",
        "Text with *emphsis*, `codezz`, and [a lnk](https://exmpl.com/pathzz).",
        "",
        "```python",
        "def fnzz(): pass",
        "```",
        "- an itm",
        "> a quot",
      ].join("\n"),
    );
    expect(checked).toEqual(
      expect.arrayContaining(["headng", "emphsis", "lnk", "itm", "quot", "Text"]),
    );
    for (const word of ["marp", "gaia", "codezz", "exmpl", "pathzz", "fnzz", "python", "def"]) {
      expect(checked).not.toContain(word);
    }
  });

  it("reads LaTeX text and comments, not commands, environments, labels, or math", () => {
    const { checked } = split(
      "latex",
      "tex",
      [
        "\\documentclass{article}",
        "\\begin{document}",
        "\\section{Introdction}",
        "Some txt \\cite{keyzz} and $\\alpha + mathzz$. % a coment",
        "\\label{sec:lblzz}",
        "\\begin{tabular}{lcrzz}",
        "\\includegraphics[width=1cm]{figs/plotzz} \\href{https://hostzz.org}{Lnk txt}",
        "\\begin{itemize}",
        "\\item An itm",
        "\\end{document}",
      ].join("\n"),
    );
    expect(checked).toEqual(
      expect.arrayContaining(["Introdction", "Some", "txt", "coment", "Lnk", "itm"]),
    );
    for (const word of [
      "documentclass",
      "article",
      "begin",
      "document",
      "section",
      "cite",
      "keyzz",
      "alpha",
      "mathzz",
      "label",
      "lblzz",
      "lcrzz",
      "width",
      "figs",
      "plotzz",
      "hostzz",
      "itemize",
    ]) {
      expect(checked).not.toContain(word);
    }
  });

  it("reads only comments in code", () => {
    const { checked } = split(
      "python",
      "py",
      ["# A coment about it", "def fnzz(argzz):", '    return "strzz"  # anothr'].join("\n"),
    );
    expect(checked).toEqual(["A", "coment", "about", "it", "anothr"]);
  });
});
