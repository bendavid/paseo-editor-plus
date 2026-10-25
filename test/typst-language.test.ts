import { StringStream } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { typstStreamParser } from "../client/web/typst-language";

function tokens(lines: string[]): [string, string | null][][] {
  const state = typstStreamParser.startState!(2);
  return lines.map((line) => {
    const out: [string, string | null][] = [];
    if (line === "") {
      typstStreamParser.blankLine?.(state, 2);
      return out;
    }
    const stream = new StringStream(line, 2, 2);
    while (!stream.eol()) {
      const style = typstStreamParser.token(stream, state);
      const text = stream.current();
      if (text.trim()) out.push([text, style]);
      stream.start = stream.pos;
    }
    return out;
  });
}

const styleOf = (lines: [string, string | null][][], text: string) =>
  lines.flat().find(([token]) => token === text)?.[1];

describe("Typst highlighting", () => {
  it("tells markup, code, and math apart", () => {
    const lines = tokens([
      "= Introduction",
      '#set text(size: 11pt, lang: "en")',
      "Some *strong* text with $x^2$ and a <label>.",
      "#let f(x) = x + 1",
      "Back to markup.",
    ]);
    expect(lines[0][0]).toEqual(["= Introduction", "heading"]);
    expect(styleOf(lines, "#set")).toBe("keyword");
    expect(styleOf(lines, "11pt")).toBe("number");
    expect(styleOf(lines, '"en"')).toBe("string");
    expect(styleOf(lines, "<label>")).toBe("labelName");
    expect(styleOf(lines, "#let")).toBe("keyword");
    // The statement ends with its line; the next line is markup again.
    expect(lines[4].every(([, style]) => style === null)).toBe(true);
  });

  it("keeps code blocks and comments open across lines", () => {
    const lines = tokens(["#{", "  let x = 1", "}", "/* a", "b */ text"]);
    expect(styleOf([lines[1]], "let")).toBe("keyword");
    expect(lines[3][0][1]).toBe("comment");
    expect(lines[4][0]).toEqual(["b */", "comment"]);
  });
});
