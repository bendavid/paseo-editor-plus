// CodeMirror and LSP count columns in UTF-16 code units. tinymist's preview counts them in
// characters (Unicode scalar values) for jumps in both directions. They differ on lines with
// characters outside the Basic Multilingual Plane, such as emoji and some CJK.

/** The character column of a UTF-16 column in `line`. */
export function utf16ToCharColumn(line: string, utf16: number): number {
  let chars = 0;
  for (let index = 0; index < Math.min(utf16, line.length); index += 1) {
    const code = line.charCodeAt(index);
    // The low half of a surrogate pair belongs to the character already counted.
    if (code < 0xdc00 || code > 0xdfff) chars += 1;
  }
  return chars;
}

/** The UTF-16 column of a character column in `line`, clamped to the line's end. */
export function charToUtf16Column(line: string, chars: number): number {
  let index = 0;
  for (let counted = 0; counted < chars && index < line.length; counted += 1) {
    const code = line.charCodeAt(index);
    index += code >= 0xd800 && code <= 0xdbff ? 2 : 1;
  }
  return Math.min(index, line.length);
}
