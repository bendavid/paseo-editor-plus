import type { PluginTheme } from "@getpaseo/plugin";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import {
  findReferencesKeymap,
  formatDocument,
  formatKeymap,
  hoverTooltips,
  jumpToDefinitionKeymap,
  LSPClient,
  LSPPlugin,
  renameKeymap,
  serverCompletion,
  serverDiagnostics,
  signatureHelp,
  type Transport,
  Workspace,
  type WorkspaceFile,
} from "@codemirror/lsp-client";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import {
  type ChangeSet,
  Compartment,
  EditorSelection,
  EditorState,
  type Text,
} from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  ViewPlugin,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { charToUtf16Column, utf16ToCharColumn } from "../columns";
import type {
  CharPosition,
  LanguageClient,
  LanguageClientOptions,
  TypstEditor,
  TypstEditorOptions,
} from "../web-contract";
import { typstStreamParser } from "./typst-language";

export type { CharPosition } from "../web-contract";

/** How long after typing the text goes to tinymist, which recompiles the preview. */
const SYNC_DELAY_MS = 120;

/** One file per client; definitions elsewhere are reported instead of opened. */
class SingleFileWorkspace extends Workspace {
  files: (WorkspaceFile & { view: EditorView })[] = [];
  private versions = 0;

  constructor(
    client: LSPClient,
    private readonly otherFile: (uri: string) => void,
  ) {
    super(client);
  }

  syncFiles(): ReturnType<Workspace["syncFiles"]> {
    const updates: { changes: ChangeSet; file: WorkspaceFile; prevDoc: Text }[] = [];
    for (const file of this.files) {
      const plugin = LSPPlugin.get(file.view);
      if (!plugin || plugin.unsyncedChanges.empty) continue;
      updates.push({ changes: plugin.unsyncedChanges, file, prevDoc: file.doc });
      file.doc = file.view.state.doc;
      file.version = ++this.versions;
      plugin.clear();
    }
    return updates;
  }

  openFile(uri: string, languageId: string, view: EditorView): void {
    if (this.getFile(uri)) return;
    const file = {
      uri,
      languageId,
      version: ++this.versions,
      doc: view.state.doc as Text,
      view,
      getView: () => view,
    };
    this.files.push(file);
    this.client.didOpen(file);
  }

  closeFile(uri: string): void {
    if (!this.getFile(uri)) return;
    this.files = this.files.filter((file) => file.uri !== uri);
    this.client.didClose(uri);
  }

  displayFile(uri: string): Promise<EditorView | null> {
    const file = this.getFile(uri);
    if (file) return Promise.resolve(file.getView());
    this.otherFile(uri);
    return Promise.resolve(null);
  }
}

/**
 * Hover and completion documentation is Markdown from tinymist, which can quote package docs.
 * Keep the formatting and drop anything that could run.
 */
function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc
    .querySelectorAll("script, style, iframe, object, embed, link, meta, form")
    .forEach((node) => node.remove());
  for (const element of Array.from(doc.body.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on") || value.startsWith("javascript:") || value.startsWith("data:")) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return doc.body.innerHTML;
}

export function createLanguageClient(options: LanguageClientOptions): LanguageClient {
  const client = new LSPClient({
    rootUri: options.rootUri,
    // Requests cross the network when the daemon is remote, and tinymist compiles first.
    timeout: 20_000,
    initializationOptions: options.initializationOptions,
    sanitizeHTML: sanitizeHtml,
    workspace: (lspClient) => new SingleFileWorkspace(lspClient, options.otherFile),
    extensions: [
      serverCompletion(),
      hoverTooltips(),
      signatureHelp(),
      serverDiagnostics(),
      {
        editorExtension: keymap.of([
          ...formatKeymap,
          ...renameKeymap,
          ...jumpToDefinitionKeymap,
          ...findReferencesKeymap,
        ]),
      },
    ],
  });
  return client.connect(options.transport as Transport);
}

/** Sends edits to tinymist soon after typing, so the preview keeps up. */
const quickSync = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | null = null;
    constructor(private readonly view: EditorView) {}
    update(update: { docChanged: boolean }) {
      if (!update.docChanged) return;
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        LSPPlugin.get(this.view)?.client.sync();
      }, SYNC_DELAY_MS);
    }
    destroy() {
      if (this.timer !== null) clearTimeout(this.timer);
    }
  },
);

function isDark(theme: PluginTheme): boolean {
  const hex = /^#?([0-9a-f]{6})$/i.exec(theme.colors.surface0.trim())?.[1];
  if (!hex) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5;
}

function highlightStyle(theme: PluginTheme): HighlightStyle {
  const dark = isDark(theme);
  const c = dark
    ? {
        keyword: "#c792ea",
        fn: "#82aaff",
        string: "#c3e88d",
        number: "#f78c6c",
        comment: "#7f848e",
        heading: "#ffcb6b",
        label: "#89ddff",
        math: "#f07178",
      }
    : {
        keyword: "#7c3aed",
        fn: "#1d4ed8",
        string: "#15803d",
        number: "#b45309",
        comment: "#6b7280",
        heading: "#b91c1c",
        label: "#0e7490",
        math: "#be185d",
      };
  return HighlightStyle.define([
    { tag: tags.keyword, color: c.keyword },
    { tag: [tags.function(tags.variableName), tags.propertyName], color: c.fn },
    { tag: tags.variableName, color: c.fn },
    { tag: tags.special(tags.variableName), color: c.math },
    { tag: tags.string, color: c.string },
    { tag: [tags.number, tags.atom], color: c.number },
    { tag: tags.comment, color: c.comment, fontStyle: "italic" },
    { tag: tags.heading, color: c.heading, fontWeight: "bold" },
    { tag: tags.strong, fontWeight: "bold" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: [tags.labelName, tags.link, tags.url], color: c.label },
    { tag: tags.monospace, color: c.string },
    { tag: [tags.escape, tags.list, tags.meta], color: c.keyword },
  ]);
}

function editorTheme(theme: PluginTheme) {
  const { colors } = theme;
  return EditorView.theme(
    {
      "&": { height: "100%", color: colors.foreground, backgroundColor: colors.surface0 },
      ".cm-scroller": {
        overflow: "auto",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
        fontSize: "13px",
        lineHeight: "1.55",
      },
      ".cm-content": { padding: "8px 0", caretColor: colors.foreground },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: colors.foreground },
      ".cm-gutters": {
        backgroundColor: colors.surface0,
        color: colors.foregroundMuted,
        border: "none",
      },
      ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: colors.surface1 },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
        backgroundColor: `${colors.accent}40`,
      },
      ".cm-tooltip": {
        backgroundColor: colors.surface0,
        color: colors.foreground,
        border: `1px solid ${colors.border}`,
        borderRadius: "6px",
      },
      ".cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: colors.accent,
        color: colors.accentForeground,
      },
      ".cm-panels": { backgroundColor: colors.surface1, color: colors.foreground },
      ".cm-lsp-documentation code, .cm-lsp-documentation pre": { fontSize: "12px" },
    },
    { dark: isDark(theme) },
  );
}

export function createTypstEditor(options: TypstEditorOptions): TypstEditor {
  const lspSlot = new Compartment();
  const themeSlot = new Compartment();
  let applyingHostText = false;

  const charPosition = (state: EditorState, pos: number): CharPosition => {
    const line = state.doc.lineAt(pos);
    return { line: line.number - 1, character: utf16ToCharColumn(line.text, pos - line.from) };
  };
  const offset = (state: EditorState, position: CharPosition): number => {
    const lineNumber = Math.min(Math.max(1, position.line + 1), state.doc.lines);
    const line = state.doc.line(lineNumber);
    return line.from + charToUtf16Column(line.text, Math.max(0, position.character));
  };

  const view = new EditorView({
    parent: options.parent as HTMLElement,
    state: EditorState.create({
      doc: options.text,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        StreamLanguage.define(typstStreamParser),
        EditorView.lineWrapping,
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...lintKeymap,
          indentWithTab,
        ]),
        EditorView.contentAttributes.of({ "aria-label": "Typst editor" }),
        themeSlot.of([
          editorTheme(options.theme),
          syntaxHighlighting(highlightStyle(options.theme)),
        ]),
        lspSlot.of([]),
        quickSync,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingHostText) {
            options.onChange(update.state.doc.toString());
          }
          if (update.selectionSet) {
            const pointer = update.transactions.some((tr) => tr.isUserEvent("select.pointer"));
            options.onCursor(charPosition(update.state, update.state.selection.main.head), pointer);
          }
        }),
      ],
    }),
  });

  return {
    setText(text) {
      if (view.state.doc.toString() === text) return;
      applyingHostText = true;
      try {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      } finally {
        applyingHostText = false;
      }
    },
    reveal(start, end) {
      const anchor = offset(view.state, start);
      const head = end ? offset(view.state, end) : anchor;
      view.dispatch({
        selection: EditorSelection.single(anchor, head),
        effects: EditorView.scrollIntoView(anchor, { y: "center" }),
        userEvent: "select.reveal",
      });
      view.focus();
    },
    cursor() {
      return charPosition(view.state, view.state.selection.main.head);
    },
    setLanguageClient(client, fileUri) {
      const lsp = client as LSPClient | null;
      view.dispatch({ effects: lspSlot.reconfigure(lsp ? lsp.plugin(fileUri, "typst") : []) });
    },
    format() {
      formatDocument(view);
    },
    setTheme(theme) {
      view.dispatch({
        effects: themeSlot.reconfigure([
          editorTheme(theme),
          syntaxHighlighting(highlightStyle(theme)),
        ]),
      });
    },
    focus() {
      view.focus();
    },
    destroy() {
      view.destroy();
    },
  };
}
