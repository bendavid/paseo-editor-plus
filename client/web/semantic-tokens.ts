import { LSPPlugin } from "@codemirror/lsp-client";
import {
  type Extension,
  Prec,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

// LSP semantic tokens as CodeMirror decorations. @codemirror/lsp-client does not implement them.
// The approach follows Ahdeyyy/typwriter's semantic-tokens.ts (MIT): the decorations sit in a
// state field that maps them through edits until fresh ones arrive, the request runs inside the
// client's position mapping, and they take precedence over the grammar's highlighting, which
// still colours everything the server leaves out. Added here: delta requests, the server's
// refresh request, and a per-language list of token types left to the grammar.

/** Wait after an edit before asking again; each request is a round trip to the daemon host. */
const REFRESH_DELAY_MS = 250;

/** What the client tells the server it can render. */
export const SEMANTIC_TOKENS_CAPABILITY = {
  textDocument: {
    semanticTokens: {
      // Static registration puts the legend in the `initialize` result.
      dynamicRegistration: false,
      requests: { full: { delta: true } },
      tokenTypes: [],
      tokenModifiers: [],
      formats: ["relative"],
      multilineTokenSupport: false,
      overlappingTokenSupport: false,
      augmentsSyntaxTokens: true,
    },
  },
};

interface Legend {
  tokenTypes: string[];
  tokenModifiers: string[];
}

interface Provider {
  legend: Legend;
  full?: boolean | { delta?: boolean };
}

const setTokens = StateEffect.define<DecorationSet>();
/** Ask for tokens again, as the server's `workspace/semanticTokens/refresh` does. */
export const refreshSemanticTokens = StateEffect.define<null>();

const tokenField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(tokens, tr) {
    let next = tokens.map(tr.changes);
    for (const effect of tr.effects) if (effect.is(setTokens)) next = effect.value;
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Applies `{start, deleteCount, data}` edits to the previous token array. */
export function applyTokenEdits(
  data: readonly number[],
  edits: readonly { start: number; deleteCount: number; data?: number[] }[],
): number[] {
  const next = [...data];
  // Edits refer to positions in the old array; apply from the end so earlier ones stay valid.
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    next.splice(edit.start, edit.deleteCount, ...(edit.data ?? []));
  }
  return next;
}

export interface DecodedToken {
  from: number;
  to: number;
  type: string;
  modifiers: string[];
}

/** Decodes the relative five-integer encoding against `doc`, skipping `plain` token types. */
export function decodeTokens(
  data: readonly number[],
  legend: Legend,
  doc: Text,
  plain: ReadonlySet<string>,
): DecodedToken[] {
  const tokens: DecodedToken[] = [];
  let line = 0;
  let character = 0;
  for (let index = 0; index + 4 < data.length; index += 5) {
    const deltaLine = data[index];
    line += deltaLine;
    character = deltaLine === 0 ? character + data[index + 1] : data[index + 1];
    const type = legend.tokenTypes[data[index + 3]];
    if (!type || plain.has(type) || line >= doc.lines) continue;
    const docLine = doc.line(line + 1);
    const from = Math.min(docLine.from + character, docLine.to);
    const to = Math.min(from + data[index + 2], docLine.to);
    if (to <= from) continue;
    const bits = data[index + 4];
    const modifiers = legend.tokenModifiers.filter((_, bit) => bits & (1 << bit));
    tokens.push({ from, to, type, modifiers });
  }
  return tokens;
}

function className(token: DecodedToken): string {
  return [
    `cm-sem-${token.type}`,
    ...token.modifiers.map((modifier) => `cm-sem-m-${modifier}`),
  ].join(" ");
}

class SemanticTokensPlugin {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private again = false;
  private resultId: string | null = null;
  private data: number[] = [];
  private destroyed = false;

  constructor(
    private readonly view: EditorView,
    private readonly plain: ReadonlySet<string>,
  ) {
    this.schedule(0);
  }

  update(update: ViewUpdate) {
    const asked = update.transactions.some((tr) =>
      tr.effects.some((e) => e.is(refreshSemanticTokens)),
    );
    if (update.docChanged || asked) this.schedule(REFRESH_DELAY_MS);
  }

  destroy() {
    this.destroyed = true;
    if (this.timer !== null) clearTimeout(this.timer);
  }

  private schedule(delay: number) {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, delay);
  }

  private async refresh(): Promise<void> {
    if (this.inFlight) {
      this.again = true;
      return;
    }
    const plugin = LSPPlugin.get(this.view);
    if (!plugin) return;
    this.inFlight = true;
    try {
      await plugin.client.initializing;
      const provider = plugin.client.serverCapabilities?.semanticTokensProvider as
        Provider | undefined;
      if (!provider?.full || this.destroyed) return;
      const canDelta = typeof provider.full === "object" && provider.full.delta === true;
      plugin.client.sync();
      const doc = plugin.syncedDoc;
      const textDocument = { uri: plugin.uri };
      const decorations = await plugin.client.withMapping(async (mapping) => {
        let data: number[];
        let resultId: string | null;
        const previous = this.resultId;
        if (canDelta && previous !== null) {
          const delta = (await plugin.client.request("textDocument/semanticTokens/full/delta", {
            textDocument,
            previousResultId: previous,
          })) as {
            resultId?: string;
            data?: number[];
            edits?: { start: number; deleteCount: number; data?: number[] }[];
          } | null;
          if (!delta) return null;
          data = delta.edits ? applyTokenEdits(this.data, delta.edits) : (delta.data ?? []);
          resultId = delta.resultId ?? null;
        } else {
          const full = (await plugin.client.request("textDocument/semanticTokens/full", {
            textDocument,
          })) as { resultId?: string; data: number[] } | null;
          if (!full) return null;
          data = full.data;
          resultId = full.resultId ?? null;
        }
        this.data = data;
        this.resultId = resultId;
        const builder = new RangeSetBuilder<Decoration>();
        const mapped = decodeTokens(data, provider.legend, doc, this.plain)
          .map((token) => ({
            ...token,
            from: mapping.mapPos(plugin.uri, token.from, 1),
            to: mapping.mapPos(plugin.uri, token.to, -1),
          }))
          .filter((token) => token.to > token.from)
          .sort((a, b) => a.from - b.from);
        for (const token of mapped) {
          builder.add(token.from, token.to, Decoration.mark({ class: className(token) }));
        }
        return builder.finish();
      });
      if (decorations && !this.destroyed)
        this.view.dispatch({ effects: setTokens.of(decorations) });
    } catch {
      // A failed or cancelled request: start over with a full request next time.
      this.resultId = null;
    } finally {
      this.inFlight = false;
      if (this.again && !this.destroyed) {
        this.again = false;
        this.schedule(REFRESH_DELAY_MS);
      }
    }
  }
}

/** Server-provided highlighting for the open file. `plainTypes` are left to the grammar. */
export function semanticTokens(plainTypes: readonly string[]): Extension {
  const plain = new Set(plainTypes);
  return [
    // Higher precedence renders these marks inside the grammar's, so their colours win where set.
    Prec.high(tokenField),
    ViewPlugin.define((view) => new SemanticTokensPlugin(view, plain)),
  ];
}
