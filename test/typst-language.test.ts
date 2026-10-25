import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
import { describe, expect, it } from "vitest";
import { typst } from "../client/web/languages/typst";
import { LanguageSupport } from "@codemirror/language";

const classes = tagHighlighter([
  { tag: tags.heading, class: "heading" },
  { tag: tags.keyword, class: "keyword" },
  { tag: tags.string, class: "string" },
  { tag: tags.number, class: "number" },
  { tag: tags.strong, class: "strong" },
  { tag: tags.comment, class: "comment" },
  { tag: tags.function(tags.variableName), class: "function" },
]);

function highlight(source: string): Record<string, string[]> {
  const support = typst.support() as LanguageSupport;
  const tree = support.language.parser.parse(source);
  const found: Record<string, string[]> = {};
  highlightTree(tree, classes, (from, to, cls) => {
    for (const name of cls.split(" ")) (found[name] ??= []).push(source.slice(from, to));
  });
  return found;
}

describe("Typst grammar highlighting", () => {
  it("parses markup, code, and math with Typst's own node kinds", () => {
    const found = highlight(
      [
        "= Introduction",
        '#set text(size: 11pt, lang: "en")',
        "Some *strong* text // note",
        "#let f(x) = x + 1",
      ].join("\n"),
    );
    expect(found.heading?.join("")).toContain("Introduction");
    expect(found.keyword).toEqual(expect.arrayContaining(["set", "let"]));
    expect(found.string).toContain('"en"');
    expect(found.number).toContain("11pt");
    expect(found.strong?.join("")).toContain("strong");
    expect(found.comment).toContain("// note");
    expect(found.function).toContain("text");
  });
});
