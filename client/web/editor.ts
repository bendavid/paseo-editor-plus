import type { PluginTheme } from "@getpaseo/plugin";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
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
import { charToUtf16Column, utf16ToCharColumn } from "../columns";
import type {
  CharPosition,
  CodeEditor,
  CodeEditorOptions,
  LanguageClient,
  LanguageClientFile,
  LanguageClientOptions,
} from "../web-contract";
import { editorLanguage } from "./languages";
import {
  refreshSemanticTokens,
  SEMANTIC_TOKENS_CAPABILITY,
  semanticTokens,
} from "./semantic-tokens";
import { editorTheme } from "./theme";

/** How long after typing the text goes to the server; a preview recompiles from it. */
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
 * Hover and completion documentation is Markdown from the server, which can quote package docs.
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
    // Requests cross the network when the daemon is remote, and servers may compile first.
    timeout: 20_000,
    initializationOptions: options.initializationOptions,
    sanitizeHTML: sanitizeHtml,
    workspace: (lspClient) => new SingleFileWorkspace(lspClient, options.otherFile),
    extensions: [
      // With a server, its completions replace the language's own, which would repeat them.
      serverCompletion({ override: true }),
      hoverTooltips(),
      signatureHelp(),
      serverDiagnostics(),
      { clientCapabilities: SEMANTIC_TOKENS_CAPABILITY },
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

/** Sends edits to the server soon after typing, so a preview keeps up. */
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

export function createEditor(options: CodeEditorOptions): CodeEditor {
  const language = editorLanguage(options.language);
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
        foldGutter(),
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
        language.support(),
        EditorView.lineWrapping,
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          ...lintKeymap,
          indentWithTab,
        ]),
        EditorView.contentAttributes.of({ "aria-label": "Code editor" }),
        themeSlot.of(editorTheme(options.theme, language)),
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
    setLanguageClient(client, file: LanguageClientFile | null) {
      const lsp = client as LSPClient | null;
      view.dispatch({
        effects: lspSlot.reconfigure(
          lsp && file
            ? [lsp.plugin(file.uri, file.languageId), semanticTokens(file.plainTokenTypes)]
            : [],
        ),
      });
    },
    refreshSemanticTokens() {
      view.dispatch({ effects: refreshSemanticTokens.of(null) });
    },
    format() {
      formatDocument(view);
    },
    setTheme(theme: PluginTheme) {
      view.dispatch({ effects: themeSlot.reconfigure(editorTheme(theme, language)) });
    },
    focus() {
      view.focus();
    },
    destroy() {
      view.destroy();
    },
  };
}
