import {
  openExternalUrl,
  PluginFileConflictError,
  PluginFileDeletedError,
  type PluginFilePanelProps,
  useRpc,
  useSettings,
  useTabState,
  useWorkspace,
} from "@getpaseo/plugin/client";
import { Icon, Loading, useToast } from "@getpaseo/plugin/client/ui";
import type { PluginTheme } from "@getpaseo/plugin";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pressable, Text, View } from "react-native";
import { z } from "zod";
import {
  closeSession,
  connectPreview,
  locatePdf,
  openSession,
  pdfjsBinary,
  pdfjsPart,
  pollSession,
  type PreviewFrame,
  readPdf,
  renderMarkdown,
  sendLsp,
  sendPreview,
  serverSettings,
  statPdf,
  synctexForward,
  synctexInverse,
} from "../shared/rpc";
import { type LanguageProfile, languageIdFor, serverOptions } from "../shared/languages";
import { messageOf, SessionConnection } from "./connection";
import { LspTransport } from "./lsp-transport";
import { previewProvider } from "./previews";
import { InstallConfirm, installing, progressText, useServerStatus } from "./server-install";
import type { Preview, PreviewCalls, SourceLocation } from "./previews/types";
import { TooltipProvider, useTooltip } from "./tooltip";
import type { CharPosition, CodeEditor, LanguageClient, WebModules } from "./web-contract";

const SAVE_DELAY_MS = 500;
/** Cursor moves sent to the preview at most this often. */
const SCROLL_INTERVAL_MS = 120;

const VIEW_MODES = ["editor", "split", "preview"] as const;
type ViewMode = (typeof VIEW_MODES)[number];

const savedSchema = z.object({
  /** Which panes show, for a language with a preview. */
  view: z.enum(VIEW_MODES).optional(),
  /** Tabs saved before the three-way choice: false showed the editor alone. */
  preview: z.boolean().optional(),
  /** Invert the preview's colors. Null, from earlier versions, means off. */
  invert: z.boolean().nullable().default(false),
});
type Saved = z.infer<typeof savedSchema>;
const defaultSaved: Saved = { view: "split", invert: false };

function viewMode(saved: Saved): ViewMode {
  return saved.view ?? (saved.preview === false ? "editor" : "split");
}

type FileState = "loading" | "ready" | "conflict" | "deleted";
type ServerState =
  | { status: "starting" }
  | { status: "ready"; version: string | null }
  | { status: "missing" | "failed" | "ended"; message: string };

function pathFromUri(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  try {
    return decodeURIComponent(uri.slice("file://".length));
  } catch {
    return uri;
  }
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export interface EditorPanelProps extends PluginFilePanelProps {
  language: LanguageProfile;
  openSettings(): void;
}

export function EditorPanel(props: EditorPanelProps) {
  const { file, tab, theme, workspaceId, layout, params, revision, openSettings, language } = props;
  const provider = useMemo(() => previewProvider(language.preview), [language.preview]);
  const serverName = language.server.name;
  const { setModified } = tab;
  const web = useMemo(() => (require("./web") as { webModules: WebModules }).webModules, []);
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const workspaceDir = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const workspaceDirRef = useRef(workspaceDir);
  workspaceDirRef.current = workspaceDir;
  const [saved, setSaved] = useTabState(tab, savedSchema, defaultSaved);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  // Off unless the reader turns it on. Tabs saved before this default have null.
  const invert = saved.invert ?? false;
  const invertRef = useRef(invert);
  invertRef.current = invert;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const settings = useSettings(serverSettings);
  const compileOnSave =
    settings.status === "ready" && settings.values.servers[language.id]?.compileOnSave === true;
  const spellcheck =
    (settings.status === "ready" ? settings.values.servers[language.id]?.spellcheck : undefined) ??
    language.spellcheck;
  const spellcheckRef = useRef(spellcheck);
  spellcheckRef.current = spellcheck;

  const calls = {
    open: useRpc(openSession),
    send: useRpc(sendLsp),
    poll: useRpc(pollSession),
    sendPreview: useRpc(sendPreview),
    close: useRpc(closeSession),
  };
  const callsRef = useRef(calls);
  callsRef.current = calls;
  const previewCalls: PreviewCalls = {
    connectPreview: useRpc(connectPreview),
    renderMarkdown: useRpc(renderMarkdown),
    locatePdf: useRpc(locatePdf),
    statPdf: useRpc(statPdf),
    readPdf: useRpc(readPdf),
    synctexForward: useRpc(synctexForward),
    synctexInverse: useRpc(synctexInverse),
    pdfjsPart: useRpc(pdfjsPart),
    pdfjsBinary: useRpc(pdfjsBinary),
  };
  const previewCallsRef = useRef(previewCalls);
  previewCallsRef.current = previewCalls;

  const panel = useRef<View>(null);
  const editorHost = useRef<View>(null);
  const previewHost = useRef<View>(null);
  const editor = useRef<CodeEditor | null>(null);
  const text = useRef("");
  const unsaved = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [fileState, setFileState] = useState<FileState>("loading");
  const [fileError, setFileError] = useState<string | null>(null);
  const [editorReady, setEditorReady] = useState(false);

  const [server, setServer] = useState<ServerState>({ status: "starting" });
  const [restarts, setRestarts] = useState(0);
  const session = useRef<{
    connection: SessionConnection;
    client: LanguageClient;
    fileUri: string;
  } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRetries, setPreviewRetries] = useState(0);
  const preview = useRef<{
    instance: Preview | null;
    /** Frames that arrived before the preview was ready. */
    pending: PreviewFrame[];
  } | null>(null);
  const lastScroll = useRef(0);

  // --- The file: read once, save shortly after edits, follow the disk while nothing is unsaved.

  const load = useCallback(async () => {
    try {
      text.current = await file.readText();
    } catch (cause) {
      setFileError(messageOf(cause));
      return;
    }
    unsaved.current = null;
    setModified(false);
    editor.current?.setText(text.current);
    setFileError(null);
    setFileState("ready");
  }, [file, setModified]);

  const save = useCallback(
    async (force: boolean) => {
      const next = unsaved.current;
      if (next === null) return;
      try {
        await file.writeText(next, { force });
      } catch (cause) {
        if (cause instanceof PluginFileConflictError) setFileState("conflict");
        else if (cause instanceof PluginFileDeletedError) setFileState("deleted");
        else setFileError(messageOf(cause));
        return;
      }
      if (unsaved.current === next) {
        unsaved.current = null;
        setModified(false);
      }
      setFileError(null);
      setFileState("ready");
      // Servers build on save (tinymist, texlab) when told the file was saved.
      const current = session.current;
      current?.client.notify("textDocument/didSave", { textDocument: { uri: current.fileUri } });
      preview.current?.instance?.saved();
    },
    [file, setModified],
  );
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    void load();
    const unwatch = file.watch((event) => {
      if (event.type === "deleted") setFileState("deleted");
      else if (unsaved.current === null) void load();
      else setFileState("conflict");
    });
    return () => {
      unwatch();
      if (saveTimer.current !== undefined) clearTimeout(saveTimer.current);
      if (unsaved.current !== null) {
        void file.writeText(unsaved.current).catch((cause) => {
          console.warn(`Unsaved edits to ${file.name} were not written: ${messageOf(cause)}`);
        });
      }
    };
  }, [file, load]);

  // --- The preview, inside this panel.

  /** A jump from the preview (or an inverse search) to a source location. */
  const jumpToSource = useCallback(
    (jump: SourceLocation) => {
      if (jump.path === file.path) {
        // A click in the preview asks for its source; with the preview alone, show the editor.
        if (viewMode(savedRef.current) === "preview") {
          setViewRef.current("split");
          setTimeout(() => editor.current?.reveal(jump.start, jump.end), 50);
        } else {
          editor.current?.reveal(jump.start, jump.end);
        }
        return;
      }
      toastRef.current.show(
        `That is in ${baseName(jump.path)}, line ${jump.start.line + 1}. Open it from Files.`,
      );
    },
    [file.path],
  );

  const scrollPreview = useCallback((position: CharPosition) => {
    preview.current?.instance?.reveal(position);
  }, []);

  const stopPreview = useCallback(() => {
    const task = preview.current;
    preview.current = null;
    task?.instance?.destroy();
    setPreviewLoading(false);
  }, []);

  const startPreview = useCallback(async () => {
    if (!provider || preview.current) return;
    const current = session.current;
    if (provider.needsServer && !current) return;
    const task = { instance: null as Preview | null, pending: [] as PreviewFrame[] };
    preview.current = task;
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const instance = await provider.start({
        filePath: file.path,
        text: () => text.current,
        client: current?.client ?? null,
        session: current
          ? {
              id: current.connection.sessionId,
              sendPreview: (message) => current.connection.sendPreview(message),
            }
          : null,
        calls: previewCallsRef.current,
        web,
        parent: previewHost.current,
        theme: themeRef.current,
        invert: invertRef.current,
        jump: (location) => jumpToSourceRef.current(location),
        openExternal: (url) => void openExternalUrl(url).catch(() => {}),
        notice: (message) => toastRef.current.show(message),
      });
      if (preview.current !== task) {
        instance.destroy();
        return;
      }
      task.instance = instance;
      for (const frame of task.pending) instance.deliver(frame);
      task.pending = [];
    } catch (cause) {
      if (preview.current === task) {
        preview.current = null;
        setPreviewError(messageOf(cause));
      }
    } finally {
      setPreviewLoading(false);
    }
  }, [file.path, provider, web]);

  // --- The editor, mounted once the text is known.

  useLayoutEffect(() => {
    if (fileState === "loading" || editor.current) return;
    editor.current = web.createEditor({
      parent: editorHost.current,
      language: language.id,
      extension: file.extension,
      text: text.current,
      theme: themeRef.current,
      spellcheck: spellcheckRef.current,
      onChange: (next) => {
        text.current = next;
        unsaved.current = next;
        setModified(true);
        preview.current?.instance?.textChanged();
        if (saveTimer.current !== undefined) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => void saveRef.current(false), SAVE_DELAY_MS);
      },
      onCursor: (position, pointer) => {
        if (!pointer) return;
        const now = Date.now();
        if (now - lastScroll.current < SCROLL_INTERVAL_MS) return;
        lastScroll.current = now;
        scrollPreview(position);
      },
    });
    setEditorReady(true);
    // Mounts once; theme changes go through setTheme below.
  }, [fileState, language.id, scrollPreview, setModified, web]);

  useEffect(
    () => () => {
      editor.current?.destroy();
      editor.current = null;
    },
    [],
  );

  useEffect(() => {
    editor.current?.setTheme(theme);
    preview.current?.instance?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    preview.current?.instance?.setInvert(invert);
  }, [invert]);

  useEffect(() => {
    if (editorReady) editor.current?.setSpellcheck(spellcheck);
  }, [editorReady, spellcheck]);

  // Open at the line Paseo asked for, such as from an agent's file reference.
  useEffect(() => {
    if (!editorReady || params.lineStart === undefined) return;
    editor.current?.reveal({ line: Math.max(0, params.lineStart - 1), character: 0 });
  }, [editorReady, params.lineStart, revision]);

  // --- The session: the language server on the daemon host, connected to the editor.

  useEffect(() => {
    if (!editorReady) return;
    let disposed = false;
    setServer({ status: "starting" });
    void (async () => {
      const rpc = callsRef.current;
      let opened;
      try {
        opened = await rpc.open({
          language: language.id,
          file: file.path,
          root: workspaceDirRef.current ?? "",
        });
      } catch (cause) {
        if (!disposed) setServer({ status: "failed", message: messageOf(cause) });
        return;
      }
      if (disposed) {
        if (opened.ok) void rpc.close({ sessionId: opened.sessionId }).catch(() => {});
        return;
      }
      if (!opened.ok) {
        setServer({ status: opened.reason, message: opened.message });
        return;
      }
      const options = serverOptions(language, compileOnSave);
      const clientFile = {
        uri: opened.fileUri,
        languageId: languageIdFor(language, file.extension),
        plainTokenTypes: language.plainTokenTypes,
      };
      let transport: LspTransport | null = null;
      const connection = new SessionConnection(
        {
          send: (input) => callsRef.current.send(input),
          poll: (input) => callsRef.current.poll(input),
          sendPreview: (input) => callsRef.current.sendPreview(input),
          close: (input) => callsRef.current.close(input),
        },
        opened.sessionId,
        {
          lsp: (message) => transport?.receive(message),
          preview: (frame) => {
            const task = preview.current;
            if (!task) return;
            if (task.instance) task.instance.deliver(frame);
            else task.pending.push(frame);
          },
          ended: (reason) => {
            if (disposed) return;
            editor.current?.setLanguageClient(null, null);
            if (provider?.needsServer) stopPreview();
            session.current = null;
            setServer({ status: "ended", message: reason });
          },
        },
      );
      transport = new LspTransport(
        (message) => connection.sendLsp(message),
        {
          notification: (method, params) => {
            if (!provider) return false;
            const jump = provider.sourceJump(method, params);
            if (jump) {
              jumpToSourceRef.current(jump);
              return true;
            }
            return provider.swallows(method);
          },
          refreshSemanticTokens: () => editor.current?.refreshSemanticTokens(),
        },
        options,
        language.server.configSection,
      );
      const client = web.createLanguageClient({
        rootUri: opened.rootUri,
        transport,
        initializationOptions: options,
        otherFile: (uri) =>
          toastRef.current.show(
            `The definition is in ${baseName(pathFromUri(uri))}. Open it from Files.`,
          ),
      });
      session.current = { connection, client, fileUri: opened.fileUri };
      editor.current?.setLanguageClient(client, clientFile);
      try {
        await client.initializing;
      } catch (cause) {
        if (!disposed) setServer({ status: "failed", message: messageOf(cause) });
        return;
      }
      if (disposed) return;
      client.notify("workspace/didChangeConfiguration", {
        settings: { [language.server.configSection]: options },
      });
      setServer({ status: "ready", version: opened.version });
    })();
    return () => {
      disposed = true;
      if (provider?.needsServer) stopPreview();
      const current = session.current;
      session.current = null;
      if (current) {
        editor.current?.setLanguageClient(null, null);
        current.client.disconnect();
        current.connection.close();
      }
    };
  }, [compileOnSave, editorReady, file.path, language, provider, restarts, stopPreview, web]);

  // --- Toolbar actions.

  const setView = useCallback(
    (next: ViewMode) => setSaved({ view: next, invert: savedRef.current.invert }),
    [setSaved],
  );
  const toggleInvert = useCallback(() => {
    setSaved({ ...savedRef.current, invert: !invert });
  }, [invert, setSaved]);
  const showInPreview = useCallback(() => {
    const position = editor.current?.cursor();
    if (position) scrollPreview(position);
  }, [scrollPreview]);
  const format = useCallback(() => editor.current?.format(), []);
  const restart = useCallback(() => setRestarts((count) => count + 1), []);
  const reload = useCallback(() => void load(), [load]);
  const overwrite = useCallback(() => void save(true), [save]);

  const setViewRef = useRef(setView);
  setViewRef.current = setView;
  const jumpToSourceRef = useRef(jumpToSource);
  jumpToSourceRef.current = jumpToSource;

  const compileNow = useCallback(async () => {
    const current = session.current;
    const compile = language.compile;
    if (!current || !compile) return;
    // Build what is on screen: save first.
    if (unsaved.current !== null) await saveRef.current(false);
    try {
      if (compile.now.kind === "command") {
        await current.client.request("workspace/executeCommand", {
          command: compile.now.command,
          arguments: [file.path],
        });
      } else {
        const result = (await current.client.request(compile.now.method, {
          textDocument: { uri: current.fileUri },
        })) as { status?: number } | null;
        // texlab: 0 success, 1 error, 2 failure, 3 cancelled.
        if (result && typeof result.status === "number" && result.status !== 0) {
          toastRef.current.error("The build reported errors; see the problems in the editor.");
          return;
        }
      }
      toastRef.current.show("Compiled to PDF.");
      preview.current?.instance?.saved();
    } catch (cause) {
      toastRef.current.error(`Compiling failed: ${messageOf(cause)}`);
    }
  }, [file.path, language.compile]);

  const styles = useMemo(() => panelStyles(theme), [theme]);
  const ready = server.status === "ready";
  const mode: ViewMode = provider ? viewMode(saved) : "editor";
  const previewPossible = provider !== null && (!provider.needsServer || ready);
  const showPreview = previewPossible && mode !== "editor";
  const wantPreview = showPreview && editorReady;

  // The preview runs while it is shown; a server-backed one restarts with its server.
  useEffect(() => {
    if (wantPreview) void startPreview();
    else stopPreview();
  }, [previewRetries, startPreview, stopPreview, wantPreview]);
  useEffect(() => stopPreview, [stopPreview]);
  // Until the preview can show (no server yet), keep the editor rather than an empty panel.
  const showEditor = mode !== "preview" || !showPreview;
  let status: string;
  if (server.status === "starting") status = `Starting ${serverName}…`;
  else if (server.status === "ready")
    status = server.version ? `${serverName} ${server.version}` : serverName;
  else status = server.status === "missing" ? `${serverName} not found` : `${serverName} stopped`;

  return (
    <View ref={panel} style={styles.panel}>
      <TooltipProvider panel={panel} theme={theme}>
        <View style={styles.toolbar} testID="editor-plus-toolbar">
          <Text style={styles.status} numberOfLines={1} testID="editor-plus-status">
            {status}
          </Text>
          <View style={styles.group}>
            <IconButton
              theme={theme}
              icon="WandSparkles"
              label="Format document"
              tooltip="Format document (Shift+Alt+F)"
              disabled={!ready}
              onPress={format}
            />
            {language.compile ? (
              <IconButton
                theme={theme}
                icon="Hammer"
                label="Compile PDF"
                tooltip={compileOnSave ? "Compile to PDF (also on every save)" : "Compile to PDF"}
                disabled={!ready}
                onPress={() => void compileNow()}
              />
            ) : null}
            {provider ? (
              <>
                <IconButton
                  theme={theme}
                  icon="LocateFixed"
                  label="Show in preview"
                  tooltip="Show the cursor's position in the preview"
                  disabled={!showPreview}
                  onPress={showInPreview}
                />
                <IconButton
                  theme={theme}
                  icon="Contrast"
                  label={invert ? "Show original preview colors" : "Invert preview colors"}
                  selected={invert}
                  disabled={!showPreview}
                  onPress={toggleInvert}
                />
                <View style={styles.segment} testID="editor-plus-view-mode">
                  <IconButton
                    theme={theme}
                    icon="Code"
                    label="Editor only"
                    selected={mode === "editor"}
                    onPress={() => setView("editor")}
                  />
                  <IconButton
                    theme={theme}
                    icon={layout.compact ? "Rows2" : "Columns2"}
                    label="Side by side"
                    tooltip={layout.compact ? "Editor and preview" : "Side by side"}
                    selected={mode === "split"}
                    disabled={!previewPossible}
                    onPress={() => setView("split")}
                  />
                  <IconButton
                    theme={theme}
                    icon="Eye"
                    label="Preview only"
                    selected={mode === "preview"}
                    disabled={!previewPossible}
                    onPress={() => setView("preview")}
                  />
                </View>
              </>
            ) : null}
          </View>
        </View>
      </TooltipProvider>
      {fileState === "conflict" ? (
        <Banner theme={theme} testID="editor-plus-conflict" text="The file changed on disk.">
          <TextButton theme={theme} label="Reload" onPress={reload} />
          <TextButton theme={theme} label="Overwrite" onPress={overwrite} />
        </Banner>
      ) : null}
      {fileState === "deleted" ? (
        <Banner theme={theme} text="The file was deleted. Edits are kept here." />
      ) : null}
      {fileError ? <Banner theme={theme} danger text={fileError} /> : null}
      {server.status === "missing" ? (
        <MissingServer
          language={language}
          theme={theme}
          message={server.message}
          onInstalled={restart}
          onSettings={openSettings}
          onRetry={restart}
        />
      ) : null}
      {server.status === "failed" || server.status === "ended" ? (
        <Banner theme={theme} danger text={server.message} testID="editor-plus-server-error">
          <TextButton
            theme={theme}
            label={server.status === "ended" ? "Restart" : "Retry"}
            onPress={restart}
          />
        </Banner>
      ) : null}
      <View style={[styles.body, layout.compact ? styles.column : styles.row]}>
        <View style={[styles.pane, showEditor ? null : styles.hidden]}>
          <View ref={editorHost} style={styles.fill} testID="editor-plus-editor" />
          {fileState === "loading" && !fileError ? <Loading /> : null}
        </View>
        {showPreview ? (
          <View
            style={[
              styles.pane,
              showEditor ? (layout.compact ? styles.previewBelow : styles.previewBeside) : null,
            ]}
          >
            <View ref={previewHost} style={styles.fill} testID="editor-plus-preview" />
            {previewLoading ? (
              <View style={styles.overlay}>
                <Loading />
              </View>
            ) : null}
            {previewError ? (
              <View style={styles.overlay}>
                <Text style={styles.error}>{previewError}</Text>
                <TextButton
                  theme={theme}
                  label="Retry"
                  onPress={() => setPreviewRetries((count) => count + 1)}
                />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The language server is not on this host. Offer to install it (after confirming what is
 * downloaded), show progress, and start it when the install finishes.
 */
function MissingServer({
  language,
  theme,
  message,
  onInstalled,
  onSettings,
  onRetry,
}: {
  language: LanguageProfile;
  theme: PluginTheme;
  message: string;
  onInstalled(): void;
  onSettings(): void;
  onRetry(): void;
}) {
  const { status, error, install } = useServerStatus(language.id);
  const [confirming, setConfirming] = useState(false);
  const busy = installing(status);
  const phase = status?.job?.phase;
  const onInstalledRef = useRef(onInstalled);
  onInstalledRef.current = onInstalled;
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && phase === "done") onInstalledRef.current();
    wasBusy.current = busy;
  }, [busy, phase]);
  const offer = status?.install ?? null;
  // The server's own reason, such as a configured path that is not executable, until an install
  // runs.
  let text = message;
  if (busy || phase === "failed") text = progressText(status!);
  else if (error) text = error;
  return (
    <>
      <Banner
        theme={theme}
        danger={phase === "failed" || !!error}
        text={text}
        testID="editor-plus-server-error"
      >
        {offer && !busy ? (
          <TextButton theme={theme} label="Install…" onPress={() => setConfirming(true)} />
        ) : null}
        <TextButton theme={theme} label="Settings" onPress={onSettings} />
        {!busy ? <TextButton theme={theme} label="Retry" onPress={onRetry} /> : null}
      </Banner>
      <InstallConfirm
        details={offer}
        open={confirming}
        theme={theme}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void install();
        }}
      />
    </>
  );
}

interface IconButtonProps {
  theme: PluginTheme;
  icon: string;
  label: string;
  tooltip?: string;
  disabled?: boolean;
  selected?: boolean;
  onPress(): void;
}

function IconButton({ theme, icon, label, tooltip, disabled, selected, onPress }: IconButtonProps) {
  const hover = useTooltip({ text: tooltip ?? label });
  // The tooltip listens on a wrapper: a disabled Pressable reports no hover.
  return (
    <View ref={hover.ref} onPointerEnter={hover.onHoverIn} onPointerLeave={hover.onHoverOut}>
      <Pressable
        onPressIn={hover.onPressIn}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled, selected: !!selected }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
          padding: 6,
          borderRadius: 6,
          opacity: disabled ? 0.4 : 1,
          backgroundColor: selected || pressed || hovered ? theme.colors.surface2 : "transparent",
        })}
      >
        <Icon name={icon} size={16} color={theme.colors.foreground} />
      </Pressable>
    </View>
  );
}

function TextButton({
  theme,
  label,
  onPress,
}: {
  theme: PluginTheme;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ paddingHorizontal: 4 }}>
      <Text style={{ color: theme.colors.accent, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function Banner({
  theme,
  text,
  danger,
  testID,
  children,
}: {
  theme: PluginTheme;
  text: string;
  danger?: boolean;
  testID?: string;
  children?: ReactNode;
}) {
  return (
    <View
      testID={testID}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 6,
        backgroundColor: theme.colors.surface1,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      }}
    >
      <Text
        style={{
          flex: 1,
          fontSize: 13,
          color: danger ? theme.colors.statusDanger : theme.colors.foreground,
        }}
      >
        {text}
      </Text>
      {children}
    </View>
  );
}

function panelStyles(theme: PluginTheme) {
  return {
    panel: { flex: 1, minHeight: 0, backgroundColor: theme.colors.surface0 },
    toolbar: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    status: { flex: 1, fontSize: 12, color: theme.colors.foregroundMuted },
    group: { flexDirection: "row" as const, alignItems: "center" as const, gap: 2 },
    body: { flex: 1, minHeight: 0 },
    row: { flexDirection: "row" as const },
    column: { flexDirection: "column" as const },
    pane: { flex: 1, minWidth: 0, minHeight: 0 },
    previewBeside: { borderLeftWidth: 1, borderLeftColor: theme.colors.border },
    // The editor stays mounted while hidden: its language server session and text live on.
    hidden: { display: "none" as const },
    segment: {
      flexDirection: "row" as const,
      gap: 2,
      paddingLeft: 6,
      marginLeft: 4,
      borderLeftWidth: 1,
      borderLeftColor: theme.colors.border,
    },
    previewBelow: { borderTopWidth: 1, borderTopColor: theme.colors.border },
    fill: { flex: 1, minHeight: 0 },
    overlay: {
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: 8,
      padding: 16,
      backgroundColor: theme.colors.surface1,
    },
    error: { color: theme.colors.statusDanger, fontSize: 13, textAlign: "center" as const },
  };
}
