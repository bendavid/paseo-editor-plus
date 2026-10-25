import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  showTooltip,
  type Tooltip,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { componentMessage } from "../../shared/components";
import type { SpellingService } from "../web-contract";
import { proseWords, type SpellingRules, type Word } from "./spelling";

// The spellchecker: the words of the visible prose go to cspell on the daemon host, and the
// misspelled parts are underlined with the editor's own decorations, which survive the redraws
// that lose the browser's marks. Each word is asked about once per editor; typing sends only new
// words. Right-click or Mod-. on an underlined word offers cspell's suggestions and
// "Add to dictionary".

/** How long after typing or scrolling the new words are sent. */
const CHECK_DELAY_MS = 300;
/** While cspell is downloading, or after a failed call, how long until asking again. */
const RETRY_MS = 2000;
/** Words per call; the server accepts up to this many. */
const BATCH = 2000;

interface Issue {
  offset: number;
  length: number;
}

/** A misspelled part of the document. */
interface Flagged {
  from: number;
  to: number;
  word: string;
}

const misspelled = Decoration.mark({ class: "cm-spelling-error" });
/** Results arrived, or the dictionary changed: draw again. */
const refresh = StateEffect.define<{ recheck: boolean }>();
const openMenu = StateEffect.define<Flagged | null>();

const theme = EditorView.baseTheme({
  ".cm-spelling-error": {
    textDecoration: "underline wavy #4e94ce",
    textDecorationSkipInk: "none",
    textUnderlineOffset: "3px",
  },
  ".cm-tooltip.cm-spelling-menu": {
    padding: "4px 0",
    minWidth: "160px",
    font: "13px/1.4 system-ui, sans-serif",
  },
  ".cm-spelling-menu button": {
    display: "block",
    width: "100%",
    padding: "3px 12px",
    border: "none",
    background: "none",
    color: "inherit",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
  },
  ".cm-spelling-menu button:hover, .cm-spelling-menu button:focus": {
    background: "rgba(127, 127, 127, 0.2)",
    outline: "none",
  },
  ".cm-spelling-menu .cm-spelling-note": { padding: "3px 12px", opacity: "0.7" },
  ".cm-spelling-menu hr": {
    border: "none",
    borderTop: "1px solid rgba(127, 127, 127, 0.3)",
    margin: "4px 0",
  },
});

export function spellchecker(rules: SpellingRules, service: SpellingService): Extension {
  /** What cspell said about each word: the misspelled parts, empty when it is fine. */
  const results = new Map<string, Issue[]>();
  const pending = new Set<string>();

  const collect = (view: EditorView): Word[] => {
    const tree = syntaxTree(view.state);
    return view.visibleRanges.flatMap(({ from, to }) =>
      proseWords(tree, view.state.doc, rules, from, to),
    );
  };

  class Checker {
    decorations: DecorationSet = Decoration.none;
    words: Word[];
    /** The last change was typing: leave the word at the cursor alone until the cursor moves. */
    private typing = false;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private destroyed = false;

    constructor(private readonly view: EditorView) {
      this.words = collect(view);
      this.decorations = this.build(view.state);
      this.schedule(0);
    }

    update(update: ViewUpdate) {
      let recheck = false;
      let redraw = false;
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(refresh)) {
            redraw = true;
            recheck ||= effect.value.recheck;
          }
        }
      }
      if (update.docChanged) {
        this.typing = update.transactions.some(
          (tr) => tr.isUserEvent("input") || tr.isUserEvent("delete"),
        );
      } else if (update.selectionSet && this.typing) {
        this.typing = false;
        redraw = true;
      }
      if (
        update.docChanged ||
        update.viewportChanged ||
        recheck ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.words = collect(update.view);
        this.schedule(CHECK_DELAY_MS);
        redraw = true;
      }
      if (redraw) this.decorations = this.build(update.state);
    }

    destroy() {
      this.destroyed = true;
      if (this.timer !== null) clearTimeout(this.timer);
    }

    /** The misspelled parts of the visible words, from what cspell has said so far. */
    flagged(state: EditorState): Flagged[] {
      const head = state.selection.main.head;
      const found: Flagged[] = [];
      for (const word of this.words) {
        const issues = results.get(word.text);
        if (!issues || issues.length === 0) continue;
        if (this.typing && word.from <= head && head <= word.to) continue;
        for (const issue of issues) {
          const from = word.from + issue.offset;
          const to = Math.min(word.to, from + issue.length);
          if (to > from) found.push({ from, to, word: state.sliceDoc(from, to) });
        }
      }
      return found;
    }

    private build(state: EditorState): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      let last = -1;
      for (const { from, to } of this.flagged(state)) {
        if (from < last) continue;
        builder.add(from, to, misspelled);
        last = to;
      }
      return builder.finish();
    }

    private schedule(delay: number) {
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.check();
      }, delay);
    }

    private async check() {
      const unknown = [
        ...new Set(this.words.map((word) => word.text).filter((w) => !results.has(w))),
      ]
        .filter((word) => !pending.has(word))
        .slice(0, BATCH);
      if (unknown.length === 0) return;
      for (const word of unknown) pending.add(word);
      let retry = false;
      try {
        const answer = await service.check(unknown);
        if (answer.state === "ready") {
          service.onStatus(null);
          const byWord = new Map<string, Issue[]>(unknown.map((word) => [word, []]));
          for (const issue of answer.issues) {
            byWord.get(unknown[issue.index])?.push({ offset: issue.offset, length: issue.length });
          }
          for (const [word, issues] of byWord) results.set(word, issues);
        } else {
          // Downloading cspell, or it failed: say so, and ask again shortly.
          service.onStatus(
            componentMessage({
              id: "spelling",
              state: answer.state,
              version: "",
              folder: null,
              error: answer.error,
            }),
          );
          retry = true;
        }
      } catch (error) {
        service.onStatus(`Spelling: ${error instanceof Error ? error.message : String(error)}`);
        retry = true;
      } finally {
        for (const word of unknown) pending.delete(word);
      }
      if (this.destroyed) return;
      if (retry) {
        this.schedule(RETRY_MS);
        return;
      }
      this.view.dispatch({ effects: refresh.of({ recheck: false }) });
      // More words than one call takes: send the rest.
      if (this.words.some((word) => !results.has(word.text))) this.schedule(0);
    }
  }

  const checker = ViewPlugin.fromClass(Checker, {
    decorations: (plugin) => plugin.decorations,
  });

  const flaggedAt = (view: EditorView, pos: number): Flagged | null =>
    view
      .plugin(checker)
      ?.flagged(view.state)
      .find((found) => found.from <= pos && pos <= found.to) ?? null;

  const close = (view: EditorView) => view.dispatch({ effects: openMenu.of(null) });

  const menuTooltip = (menu: Flagged): Tooltip => ({
    pos: menu.from,
    end: menu.to,
    above: false,
    create(view) {
      const dom = document.createElement("div");
      dom.className = "cm-spelling-menu";
      dom.setAttribute("role", "menu");
      dom.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close(view);
          view.focus();
        }
      });
      const note = (text: string) => {
        const line = document.createElement("div");
        line.className = "cm-spelling-note";
        line.textContent = text;
        return line;
      };
      const item = (label: string, onPress: () => void) => {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.textContent = label;
        // Keep the editor's selection: act on click, not on focus.
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", onPress);
        return button;
      };
      const suggestions = document.createElement("div");
      suggestions.appendChild(note("Looking for suggestions…"));
      dom.appendChild(suggestions);
      dom.appendChild(document.createElement("hr"));
      dom.appendChild(
        item(`Add “${menu.word}” to dictionary`, () => {
          void service.add(menu.word).then(({ error }) => {
            if (error) {
              service.onStatus(`Could not add the word: ${error}`);
              return;
            }
            // The dictionary changed: ask about every word again.
            results.clear();
            view.dispatch({ effects: [openMenu.of(null), refresh.of({ recheck: true })] });
            view.focus();
          });
        }),
      );
      void service.suggest(menu.word).then(
        ({ suggestions: words, error }) => {
          suggestions.replaceChildren();
          if (error) suggestions.appendChild(note(error));
          else if (words.length === 0) suggestions.appendChild(note("No suggestions"));
          for (const word of words) {
            suggestions.appendChild(
              item(word, () => {
                if (view.state.sliceDoc(menu.from, menu.to) === menu.word) {
                  view.dispatch({
                    changes: { from: menu.from, to: menu.to, insert: word },
                    effects: openMenu.of(null),
                    userEvent: "input.spelling",
                  });
                } else {
                  close(view);
                }
                view.focus();
              }),
            );
          }
          (suggestions.querySelector("button") as HTMLButtonElement | null)?.focus();
        },
        (cause: unknown) => {
          suggestions.replaceChildren(note(String(cause)));
        },
      );
      return { dom };
    },
  });

  const menuField = StateField.define<Flagged | null>({
    create: () => null,
    update(menu, tr) {
      for (const effect of tr.effects) if (effect.is(openMenu)) return effect.value;
      if (!menu || tr.docChanged) return null;
      const head = tr.state.selection.main.head;
      return head < menu.from || head > menu.to ? null : menu;
    },
    provide: (field) => showTooltip.from(field, (menu) => (menu ? menuTooltip(menu) : null)),
  });

  const openAt = (view: EditorView, pos: number): boolean => {
    const found = flaggedAt(view, pos);
    if (!found) return false;
    view.dispatch({ effects: openMenu.of(found) });
    return true;
  };

  return [
    theme,
    checker,
    menuField,
    EditorView.domEventHandlers({
      contextmenu(event, view) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null || !flaggedAt(view, pos)) return false;
        // Our menu replaces the browser's (and the desktop app's) for misspelled words.
        event.preventDefault();
        return openAt(view, pos);
      },
    }),
    keymap.of([
      { key: "Mod-.", run: (view) => openAt(view, view.state.selection.main.head) },
      {
        key: "Escape",
        run: (view) => {
          if (!view.state.field(menuField)) return false;
          close(view);
          return true;
        },
      },
    ]),
  ];
}
