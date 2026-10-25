import type { StreamParser, StringStream } from "@codemirror/language";

// A Typst highlighter for CodeMirror's stream parser. It follows Typst's three modes: markup,
// code (after `#` and inside `{}`), and math (between `$`). Highlighting only; tinymist supplies
// everything that needs the real parser.

type Frame =
  /** Markup: the document itself (`close` null) or a content block `[...]`. */
  | { k: "markup"; close: "]" | null }
  /** Code inside `{...}` or `(...)`. */
  | { k: "code"; close: "}" | ")" }
  /** A statement such as `#let x = 1`; it ends with the line. */
  | { k: "line" }
  /** An embedded expression such as `#f(x)[...]`; it ends after the last call or field. */
  | { k: "expr" }
  | { k: "math" }
  /** A block of raw text, closed by as many backticks as opened it. */
  | { k: "raw"; fence: number }
  | { k: "comment"; depth: number };

interface State {
  stack: Frame[];
  strong: boolean;
  emph: boolean;
}

const KEYWORDS = new Set([
  "let",
  "set",
  "show",
  "import",
  "include",
  "if",
  "else",
  "for",
  "in",
  "while",
  "break",
  "continue",
  "return",
  "context",
  "and",
  "or",
  "not",
  "as",
]);
const ATOMS = new Set(["true", "false", "none", "auto"]);
const IDENT = /^[\p{L}_][\p{L}\p{N}_-]*/u;
const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:pt|mm|cm|in|em|fr|deg|rad|%)?/;

function top(state: State): Frame {
  return state.stack[state.stack.length - 1];
}

function pop(state: State): void {
  if (state.stack.length > 1) state.stack.pop();
}

function comment(stream: StringStream, state: State): string | null {
  if (stream.match("//")) {
    stream.skipToEnd();
    return "comment";
  }
  if (stream.match("/*")) {
    state.stack.push({ k: "comment", depth: 1 });
    return "comment";
  }
  return null;
}

function inComment(stream: StringStream, frame: Extract<Frame, { k: "comment" }>, state: State) {
  while (!stream.eol()) {
    if (stream.match("/*")) frame.depth += 1;
    else if (stream.match("*/")) {
      frame.depth -= 1;
      if (frame.depth === 0) {
        state.stack.pop();
        return "comment";
      }
    } else stream.next();
  }
  return "comment";
}

function raw(stream: StringStream, state: State): string | null {
  const ticks = stream.match(/^`+/) as RegExpMatchArray | null;
  if (!ticks) return null;
  const fence = ticks[0].length;
  if (fence >= 3) {
    stream.match(IDENT);
    state.stack.push({ k: "raw", fence });
    return "monospace";
  }
  // Inline raw: up to the next backtick on this line.
  stream.skipTo("`") ? stream.next() : stream.skipToEnd();
  return "monospace";
}

function inRaw(stream: StringStream, frame: Extract<Frame, { k: "raw" }>, state: State) {
  const close = "`".repeat(frame.fence);
  if (stream.skipTo(close)) {
    stream.match(close);
    state.stack.pop();
  } else stream.skipToEnd();
  return "monospace";
}

/** `#` in markup or math starts code: a statement, a block, or an expression. */
function hash(stream: StringStream, state: State): string | null {
  if (!stream.match("#")) return null;
  const word = stream.match(IDENT, false) as RegExpMatchArray | null;
  if (word && KEYWORDS.has(word[0])) {
    stream.match(IDENT);
    // `#let`, `#if ... {}`, and the like run to the end of the line or their last bracket.
    state.stack.push({ k: "line" });
    return "keyword";
  }
  if (word) {
    stream.match(IDENT);
    state.stack.push({ k: "expr" });
    return stream.peek() === "(" || stream.peek() === "["
      ? "variableName.function"
      : "variableName";
  }
  if (stream.match("{")) {
    state.stack.push({ k: "code", close: "}" });
    return "brace";
  }
  if (stream.match("(")) {
    state.stack.push({ k: "expr" }, { k: "code", close: ")" });
    return "paren";
  }
  if (stream.match("[")) {
    state.stack.push({ k: "markup", close: "]" });
    return "squareBracket";
  }
  return "meta";
}

function markup(stream: StringStream, state: State, frame: Extract<Frame, { k: "markup" }>) {
  const found = comment(stream, state) ?? raw(stream, state) ?? hash(stream, state);
  if (found) return found;
  if (stream.sol()) {
    stream.eatSpace();
    if (stream.match(/^=+\s/)) {
      stream.skipToEnd();
      return "heading";
    }
    if (stream.match(/^([-+]|\d+\.)\s/)) return "list";
    if (stream.match(/^\/\s[^:]*:/)) return "list";
    if (stream.eol()) return null;
  }
  if (frame.close && stream.peek() === "]") {
    stream.next();
    pop(state);
    return "squareBracket";
  }
  if (stream.match("$")) {
    state.stack.push({ k: "math" });
    return "keyword";
  }
  if (stream.match(/^\\(u\{[0-9a-fA-F]+\}|.)/)) return "escape";
  if (stream.match(/^<[\p{L}\p{N}_:.-]+>/u)) return "labelName";
  if (stream.match(/^@[\p{L}\p{N}_:.-]+/u)) return "link";
  if (stream.match(/^https?:\/\/[^\s)\]>]+/)) return "url";
  if (stream.match(/^(---|--|\.\.\.|~)/)) return "operator";
  if (stream.match("*")) {
    state.strong = !state.strong;
    return "strong";
  }
  if (stream.match("_")) {
    state.emph = !state.emph;
    return "emphasis";
  }
  stream.match(/^[^*_`$#\\<@\/\]h~.-]+/) || stream.next();
  if (state.strong && state.emph) return "strong emphasis";
  if (state.strong) return "strong";
  if (state.emph) return "emphasis";
  return null;
}

function code(stream: StringStream, state: State): string | null {
  const found = comment(stream, state) ?? raw(stream, state);
  if (found) return found;
  if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
  if (stream.match(NUMBER)) return "number";
  const word = stream.match(IDENT) as RegExpMatchArray | null;
  if (word) {
    if (KEYWORDS.has(word[0])) return "keyword";
    if (ATOMS.has(word[0])) return "atom";
    return stream.peek() === "(" || stream.peek() === "["
      ? "variableName.function"
      : "variableName";
  }
  if (stream.match("{")) {
    state.stack.push({ k: "code", close: "}" });
    return "brace";
  }
  if (stream.match("(")) {
    state.stack.push({ k: "code", close: ")" });
    return "paren";
  }
  if (stream.match("[")) {
    state.stack.push({ k: "markup", close: "]" });
    return "squareBracket";
  }
  if (stream.match("$")) {
    state.stack.push({ k: "math" });
    return "keyword";
  }
  const frame = top(state);
  if (frame.k === "code" && stream.peek() === frame.close) {
    stream.next();
    pop(state);
    return frame.close === "}" ? "brace" : "paren";
  }
  if (stream.match(/^(=>|==|!=|<=|>=|\+=|-=|\*=|\/=|\.\.|[-+*\/=<>:.,;])/)) return "operator";
  stream.next();
  return null;
}

function expr(stream: StringStream, state: State): string | null {
  // An embedded expression continues with fields, calls, and trailing content blocks.
  if (stream.match(/^\.[\p{L}_][\p{L}\p{N}_-]*/u)) {
    return stream.peek() === "(" || stream.peek() === "["
      ? "variableName.function"
      : "propertyName";
  }
  if (stream.match("(")) {
    state.stack.push({ k: "code", close: ")" });
    return "paren";
  }
  if (stream.match("[")) {
    state.stack.push({ k: "markup", close: "]" });
    return "squareBracket";
  }
  state.stack.pop();
  return null;
}

function math(stream: StringStream, state: State): string | null {
  const found = comment(stream, state) ?? hash(stream, state);
  if (found) return found;
  if (stream.match("$")) {
    pop(state);
    return "keyword";
  }
  if (stream.match(/^\\./)) return "escape";
  if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
  if (stream.match(/^\d+(\.\d+)?/)) return "number";
  if (stream.match(/^[\p{L}][\p{L}\p{N}]+(\.[\p{L}\p{N}]+)*/u)) return "variableName.special";
  if (stream.match(/^[_^&]|^(<=|>=|!=|->|=>|<-|[-+*\/=<>])/)) return "operator";
  stream.next();
  return null;
}

export const typstStreamParser: StreamParser<State> = {
  name: "typst",
  startState: () => ({ stack: [{ k: "markup", close: null }], strong: false, emph: false }),
  copyState: (state) => ({
    stack: state.stack.map((frame) => ({ ...frame })),
    strong: state.strong,
    emph: state.emph,
  }),
  token(stream, state) {
    // A statement ends with its line unless a bracket is still open.
    if (stream.sol() && top(state).k === "line") state.stack.pop();
    // A paragraph break ends strong and emphasis in Typst only at the closing marker, but an
    // unclosed one should not color the rest of the file.
    if (stream.sol() && stream.string.trim() === "") {
      state.strong = false;
      state.emph = false;
    }
    const frame = top(state);
    switch (frame.k) {
      case "comment":
        return inComment(stream, frame, state);
      case "raw":
        return inRaw(stream, frame, state);
      case "math":
        return math(stream, state);
      case "expr":
        return expr(stream, state);
      case "code":
      case "line":
        if (stream.eatSpace()) return null;
        return code(stream, state);
      case "markup":
        return markup(stream, state, frame);
    }
  },
  blankLine(state) {
    if (top(state).k === "line") state.stack.pop();
    state.strong = false;
    state.emph = false;
  },
  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
    closeBrackets: { brackets: ["(", "[", "{", '"', "$"] },
  },
};
