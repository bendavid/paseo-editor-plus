import type { syntaxTree } from "@codemirror/language";
import type { Text } from "@codemirror/state";
import { type Highlighter, highlightTree, tagHighlighter, tags } from "@lezer/highlight";

// Which parts of a file are prose, from the language's parse tree, and the words in them. The
// spellchecker (spellchecker.ts) sends those words to cspell on the daemon host. The browser's own
// spellchecker is not used: it drops its marks whenever the editor redraws a span (language-server
// highlighting and diagnostics do so constantly) and checks again only where the user types.

type Tree = ReturnType<typeof syntaxTree>;

/** Which parts of a file are prose. */
export type SpellingRules =
  /**
   * Only the text of the `names` nodes (Typst, whose tree names its text), outside `skip` nodes
   * (raw text also has text nodes).
   */
  | { kind: "nodes"; names: readonly string[]; skip: readonly string[] }
  /**
   * Everything except what the grammar highlights as code (Markdown, LaTeX): untagged text and
   * text tagged as prose are checked. `frontmatter` skips a leading `---` block. `arguments`
   * names commands (`\\input`) whose first so many `{…}` arguments are names or paths, not text,
   * for grammars that read them as text.
   */
  | { kind: "markup"; frontmatter?: boolean; arguments?: Readonly<Record<string, number>> }
  /** Only comments (programming languages). */
  | { kind: "comments" };

export interface Range {
  from: number;
  to: number;
}

/** Tags whose text is prose; text with any other tag is code. */
const prose = tagHighlighter([
  {
    tag: [
      tags.comment,
      tags.heading,
      tags.emphasis,
      tags.strong,
      tags.strikethrough,
      tags.quote,
      tags.content,
      tags.list,
      tags.link,
    ],
    class: "prose",
  },
]);
/** Code inside prose: monospace is a kind of `tags.content`, so it is matched first. */
const inlineCode = tagHighlighter([{ tag: tags.monospace, class: "code" }]);
const markupClasses: Highlighter = {
  // Stream parsers (LaTeX) give the top node an empty tag list: it is text, not code.
  style: (found) =>
    found.length === 0 ? null : (inlineCode.style(found) ?? prose.style(found) ?? "code"),
};
const commentClasses = tagHighlighter([{ tag: tags.comment, class: "comment" }]);

/** Highlighted ranges whose classes satisfy `test`, in order. */
function highlighted(
  tree: Tree,
  highlighter: Highlighter,
  test: (classes: string) => boolean,
  from: number,
  to: number,
): Range[] {
  const ranges: Range[] = [];
  highlightTree(
    tree,
    highlighter,
    (start, end, classes) => {
      if (test(classes)) ranges.push({ from: start, to: end });
    },
    from,
    to,
  );
  return ranges;
}

/** The parts of `[from, to]` outside `ranges` (sorted, possibly overlapping). */
function complement(ranges: Range[], from: number, to: number): Range[] {
  const gaps: Range[] = [];
  let pos = from;
  for (const range of ranges) {
    if (range.from > pos) gaps.push({ from: pos, to: Math.min(range.from, to) });
    pos = Math.max(pos, range.to);
    if (pos >= to) break;
  }
  if (pos < to) gaps.push({ from: pos, to });
  return gaps.filter((gap) => gap.to > gap.from);
}

/** The end of a leading `---` … `---` block, or 0. */
function frontmatterEnd(doc: Text): number {
  if (doc.lines < 2 || doc.line(1).text.trimEnd() !== "---") return 0;
  for (let number = 2; number <= doc.lines; number += 1) {
    const line = doc.line(number);
    if (line.text.trimEnd() === "---") return line.to;
  }
  return 0;
}

/** How far to look for the end of a command's arguments. */
const ARGUMENT_SCAN = 2000;

/**
 * The end of the first `count` brace groups after `pos`, skipping `[…]` options and spaces between
 * them; `pos` if none follows.
 */
function argumentsEnd(doc: Text, pos: number, count: number): number {
  const text = doc.sliceString(pos, Math.min(doc.length, pos + ARGUMENT_SCAN));
  let index = 0;
  let end = 0;
  let found = 0;
  while (found < count) {
    while (text[index] === " " || text[index] === "\t") index += 1;
    const open = text[index];
    if (open !== "{" && open !== "[") break;
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let closed = -1;
    for (let at = index; at < text.length; at += 1) {
      const char = text[at];
      if (char === "\\") at += 1;
      else if (char === open) depth += 1;
      else if (char === close && --depth === 0) {
        closed = at;
        break;
      }
    }
    if (closed < 0) break;
    index = closed + 1;
    end = index;
    if (open === "{") found += 1;
  }
  return pos + end;
}

/** The arguments of the commands named in `commands`, from LaTeX-style `\\name` nodes. */
function commandArguments(
  tree: Tree,
  doc: Text,
  commands: Readonly<Record<string, number>>,
  from: number,
  to: number,
): Range[] {
  const ranges: Range[] = [];
  tree.iterate({
    from,
    to,
    enter(node) {
      if (node.to - node.from > 40) return;
      const name = /^\\([A-Za-z@]+)\*?$/.exec(doc.sliceString(node.from, node.to))?.[1];
      const count = name ? commands[name] : undefined;
      if (!count) return;
      const end = argumentsEnd(doc, node.to, count);
      if (end > node.to) ranges.push({ from: node.to, to: end });
    },
  });
  return ranges;
}

const LETTER = /\p{L}/u;

/**
 * The ranges of `[from, to]` the spellchecker should skip, in order. Ranges without letters are left
 * out: they hold no words.
 */
export function uncheckedRanges(
  tree: Tree,
  doc: Text,
  rules: SpellingRules,
  from: number,
  to: number,
): Range[] {
  let skipped: Range[];
  if (rules.kind === "markup") {
    skipped = highlighted(tree, markupClasses, (classes) => /\bcode\b/.test(classes), from, to);
    const end = rules.frontmatter ? Math.min(frontmatterEnd(doc), to) : 0;
    if (end > from) skipped.unshift({ from, to: end });
    if (rules.arguments) {
      skipped.push(...commandArguments(tree, doc, rules.arguments, from, to));
    }
  } else {
    let checked: Range[];
    if (rules.kind === "comments") {
      checked = highlighted(tree, commentClasses, () => true, from, to);
    } else {
      const names = new Set(rules.names);
      const skip = new Set(rules.skip);
      checked = [];
      tree.iterate({
        from,
        to,
        enter(node) {
          if (skip.has(node.name)) return false;
          if (!names.has(node.name)) return;
          checked.push({ from: Math.max(node.from, from), to: Math.min(node.to, to) });
          return false;
        },
      });
    }
    skipped = complement(checked, from, to);
  }
  return skipped
    .filter((range) => LETTER.test(doc.sliceString(range.from, range.to)))
    .sort((a, b) => a.from - b.from);
}

/** A word of prose: where it is, and its text. */
export interface Word {
  from: number;
  to: number;
  text: string;
}

/** Letters, marks, digits, apostrophes, and underscores; cspell splits compounds itself. */
const WORD = /[\p{L}\p{M}\p{N}_'’]+/gu;
const MAX_WORD = 100;

/** The words of prose in `[from, to]`, in order. */
export function proseWords(
  tree: Tree,
  doc: Text,
  rules: SpellingRules,
  from: number,
  to: number,
): Word[] {
  const words: Word[] = [];
  let pos = from;
  const take = (start: number, end: number) => {
    if (end <= start) return;
    const text = doc.sliceString(start, end);
    for (const match of text.matchAll(WORD)) {
      // Apostrophes around a word are quotes.
      const raw = match[0];
      const lead = raw.length - raw.replace(/^['’]+/, "").length;
      const word = raw.slice(lead).replace(/['’]+$/, "");
      if (!word || word.length > MAX_WORD || !LETTER.test(word)) continue;
      const at = start + (match.index ?? 0) + lead;
      words.push({ from: at, to: at + word.length, text: word });
    }
  };
  for (const skipped of uncheckedRanges(tree, doc, rules, from, to)) {
    take(pos, Math.max(pos, skipped.from));
    pos = Math.max(pos, skipped.to);
  }
  take(pos, to);
  return words;
}
