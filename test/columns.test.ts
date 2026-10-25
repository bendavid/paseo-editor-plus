import { describe, expect, it } from "vitest";
import { charToUtf16Column, utf16ToCharColumn } from "../client/columns";

describe("columns", () => {
  const line = "a😀b𝑥c";

  it("counts characters, not UTF-16 units, for tinymist", () => {
    expect(utf16ToCharColumn(line, 0)).toBe(0);
    expect(utf16ToCharColumn(line, 3)).toBe(2); // after "a😀"
    expect(utf16ToCharColumn(line, 6)).toBe(4); // after "a😀b𝑥"
  });

  it("converts back to UTF-16 units and clamps at the end of the line", () => {
    expect(charToUtf16Column(line, 2)).toBe(3);
    expect(charToUtf16Column(line, 4)).toBe(6);
    expect(charToUtf16Column(line, 99)).toBe(line.length);
  });

  it("is the identity on plain text", () => {
    expect(utf16ToCharColumn("hello", 3)).toBe(3);
    expect(charToUtf16Column("hello", 3)).toBe(3);
  });
});
