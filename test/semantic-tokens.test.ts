import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { applyTokenEdits, decodeTokens } from "../client/web/semantic-tokens";

const legend = { tokenTypes: ["keyword", "function", "text"], tokenModifiers: ["strong", "math"] };

describe("semantic tokens", () => {
  it("decodes the relative encoding into document ranges with modifiers", () => {
    const doc = Text.of(["#let f(x) = x", "*bold* text"]);
    // Line 0: "#let" at 0 (keyword), "f" at 5 (function). Line 1: "*bold*" at 0 (text, strong).
    const data = [0, 0, 4, 0, 0, 0, 5, 1, 1, 0, 1, 0, 6, 2, 1];
    expect(decodeTokens(data, legend, doc, new Set())).toEqual([
      { from: 0, to: 4, type: "keyword", modifiers: [] },
      { from: 5, to: 6, type: "function", modifiers: [] },
      { from: 14, to: 20, type: "text", modifiers: ["strong"] },
    ]);
  });

  it("skips types left to the grammar and clamps tokens to their line", () => {
    const doc = Text.of(["ab", "cd"]);
    const data = [0, 0, 9, 0, 0, 1, 0, 2, 2, 0];
    expect(decodeTokens(data, legend, doc, new Set(["text"]))).toEqual([
      { from: 0, to: 2, type: "keyword", modifiers: [] },
    ]);
  });

  it("applies delta edits to the previous token array", () => {
    const previous = [0, 0, 4, 0, 0, 0, 5, 1, 1, 0];
    const next = applyTokenEdits(previous, [
      { start: 5, deleteCount: 5, data: [0, 6, 2, 1, 2] },
      { start: 0, deleteCount: 0, data: [] },
    ]);
    expect(next).toEqual([0, 0, 4, 0, 0, 0, 6, 2, 1, 2]);
  });
});
