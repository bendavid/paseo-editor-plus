import { syntaxTree } from "@codemirror/language";
import { type Extension, RangeSetBuilder, type Text } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { type Highlighter, highlightTree, tagHighlighter, tags } from "@lezer/highlight";

// Spellchecking through the browser's own checker (Chromium's in the desktop app). CodeMirror turns
// it off; this turns it on for the editor and marks every range that isn't prose
// `spellcheck="false"`, using the language's parse tree. Chromium honours the attribute on spans
// inside a checked line, but not the reverse (checked spans inside an unchecked editor), so the
// marks exclude code rather than include text.

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
 * The ranges of `[from, to]` the spellchecker should skip, in order. Ranges without letters are left out:
 * they hold no words, and every excluded range splits the line into another span.
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

const unchecked = Decoration.mark({ attributes: { spellcheck: "false" } });

function decorations(view: EditorView, rules: SpellingRules): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  for (const visible of view.visibleRanges) {
    const ranges = uncheckedRanges(tree, view.state.doc, rules, visible.from, visible.to);
    // The ranges can overlap (arguments inside highlighted code); the builder needs them apart.
    let last = visible.from;
    for (const range of ranges) {
      const start = Math.max(range.from, last);
      if (range.to > start) builder.add(start, range.to, unchecked);
      last = Math.max(last, range.to);
    }
  }
  return builder.finish();
}

/** The browser's spellchecker over the prose of a file. */
export function spellcheck(rules: SpellingRules): Extension {
  return [
    EditorView.contentAttributes.of({ spellcheck: "true" }),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = decorations(view, rules);
        }
        update(update: ViewUpdate) {
          if (
            update.docChanged ||
            update.viewportChanged ||
            syntaxTree(update.startState) !== syntaxTree(update.state)
          ) {
            this.decorations = decorations(update.view, rules);
          }
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
  ];
}
