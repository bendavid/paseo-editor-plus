import {
  PluginFileConflictError,
  PluginFileDeletedError,
  type PluginFilePanelProps,
  useRpc,
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
  openSession,
  pollSession,
  type PreviewFrame,
  sendLsp,
  sendPreview,
} from "../shared/rpc";
import type { LanguageProfile } from "../shared/languages";
import { messageOf, SessionConnection } from "./connection";
import { LspTransport } from "./lsp-transport";
import { previewProvider } from "./previews";
import type { SourceLocation } from "./previews/types";
import { TooltipProvider, useTooltip } from "./tooltip";
import type {
  CharPosition,
  CodeEditor,
  LanguageClient,
  PreviewView,
  WebModules,
} from "./web-contract";

const SAVE_DELAY_MS = 500;
/** Cursor moves sent to the preview at most this often. */
const SCROLL_INTERVAL_MS = 120;

const savedSchema = z.object({
  preview: z.boolean().default(true),
  /** Invert the preview's colors. Null, from earlier versions, means off. */
  invert: z.boolean().nullable().default(false),
});
const defaultSaved = { preview: true, invert: false };

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

  const calls = {
    open: useRpc(openSession),
    send: useRpc(sendLsp),
    poll: useRpc(pollSession),
    connectPreview: useRpc(connectPreview),
    sendPreview: useRpc(sendPreview),
    close: useRpc(closeSession),
  };
  const callsRef = useRef(calls);
  callsRef.current = calls;

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
  } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const preview = useRef<{
    taskId: string;
    view: PreviewView | null;
    /** Frames that arrived before the page was written. */
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

  // --- The preview, inside this panel, fed through the session.

  /** How a preview reaches the language server: commands, and the file it shows. */
  const previewContext = useCallback(
    (client: LanguageClient) => ({
      filePath: file.path,
      command: (name: string, args: unknown[]) =>
        client.request("workspace/executeCommand", { command: name, arguments: args }),
    }),
    [file.path],
  );

  const scrollPreview = useCallback(
    (position: CharPosition) => {
      const client = session.current?.client;
      const task = preview.current;
      if (!client || !task?.taskId || !provider) return;
      void provider.reveal(previewContext(client), task.taskId, position).catch(() => {});
    },
    [previewContext, provider],
  );

  const stopPreview = useCallback(() => {
    const task = preview.current;
    preview.current = null;
    if (!task) return;
    task.view?.destroy();
    const client = session.current?.client;
    if (client && provider && task.taskId) {
      void provider.stop(previewContext(client), task.taskId).catch(() => {});
    }
  }, [previewContext, provider]);

  const startPreview = useCallback(async () => {
    const current = session.current;
    if (!current || preview.current || !provider) return;
    const task = { taskId: "", view: null as PreviewView | null, pending: [] as PreviewFrame[] };
    preview.current = task;
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const { task: taskId, port } = await provider.start(previewContext(current.client));
      task.taskId = taskId;
      if (preview.current !== task) {
        void provider.stop(previewContext(current.client), taskId).catch(() => {});
        return;
      }
      const sessionId = current.connection.sessionId;
      const { html } = await callsRef.current.connectPreview({
        sessionId,
        port,
        includeHtml: true,
      });
      if (preview.current !== task || !html) return;
      const view = web.mountPreview(
        previewHost.current,
        html,
        {
          reconnect: async () => {
            await callsRef.current.connectPreview({ sessionId, port, includeHtml: false });
          },
          send: (message) => current.connection.sendPreview(message),
        },
        {
          invert: invertRef.current,
          background: themeRef.current.colors.surface1,
          invertTarget: provider.invertTarget,
        },
      );
      task.view = view;
      for (const frame of task.pending) view.deliver(frame);
      task.pending = [];
    } catch (cause) {
      if (preview.current === task) {
        preview.current = null;
        setPreviewError(messageOf(cause));
      }
    } finally {
      setPreviewLoading(false);
    }
  }, [previewContext, provider, web]);

  // --- The editor, mounted once the text is known.

  useLayoutEffect(() => {
    if (fileState === "loading" || editor.current) return;
    editor.current = web.createEditor({
      parent: editorHost.current,
      language: language.id,
      text: text.current,
      theme: themeRef.current,
      onChange: (next) => {
        text.current = next;
        unsaved.current = next;
        setModified(true);
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
    preview.current?.view?.setBackground(theme.colors.surface1);
  }, [theme]);

  useEffect(() => {
    preview.current?.view?.setInvert(invert);
  }, [invert]);

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
      const onJump = (jump: SourceLocation) => {
        if (jump.path === file.path) {
          editor.current?.reveal(jump.start, jump.end);
          return;
        }
        toastRef.current.show(
          `That is in ${baseName(jump.path)}, line ${jump.start.line + 1}. Open it from Files.`,
        );
      };
      const clientFile = {
        uri: opened.fileUri,
        languageId: language.languageId,
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
            if (task.view) task.view.deliver(frame);
            else task.pending.push(frame);
          },
          ended: (reason) => {
            if (disposed) return;
            editor.current?.setLanguageClient(null, null);
            preview.current?.view?.destroy();
            preview.current = null;
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
              onJump(jump);
              return true;
            }
            return provider.swallows(method);
          },
          refreshSemanticTokens: () => editor.current?.refreshSemanticTokens(),
        },
        language.server.options,
        language.server.configSection,
      );
      const client = web.createLanguageClient({
        rootUri: opened.rootUri,
        transport,
        initializationOptions: { ...language.server.options },
        otherFile: (uri) =>
          toastRef.current.show(
            `The definition is in ${baseName(pathFromUri(uri))}. Open it from Files.`,
          ),
      });
      session.current = { connection, client };
      editor.current?.setLanguageClient(client, clientFile);
      try {
        await client.initializing;
      } catch (cause) {
        if (!disposed) setServer({ status: "failed", message: messageOf(cause) });
        return;
      }
      if (disposed) return;
      setServer({ status: "ready", version: opened.version });
      if (savedRef.current.preview) void startPreview();
    })();
    return () => {
      disposed = true;
      stopPreview();
      const current = session.current;
      session.current = null;
      if (current) {
        editor.current?.setLanguageClient(null, null);
        current.client.disconnect();
        current.connection.close();
      }
    };
  }, [editorReady, file.path, language, provider, restarts, startPreview, stopPreview, web]);

  // --- Toolbar actions.

  const togglePreview = useCallback(() => {
    const next = !savedRef.current.preview;
    setSaved({ ...savedRef.current, preview: next });
    if (next) void startPreview();
    else stopPreview();
  }, [setSaved, startPreview, stopPreview]);
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

  const styles = useMemo(() => panelStyles(theme), [theme]);
  const ready = server.status === "ready";
  const showPreview = provider !== null && saved.preview && ready;
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
                <IconButton
                  theme={theme}
                  icon={layout.compact ? "PanelBottom" : "PanelRight"}
                  label="Preview"
                  tooltip={saved.preview ? "Hide the preview" : "Show the preview"}
                  selected={saved.preview}
                  disabled={!ready}
                  onPress={togglePreview}
                />
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
      {server.status === "missing" || server.status === "failed" || server.status === "ended" ? (
        <Banner
          theme={theme}
          danger={server.status !== "missing"}
          text={server.message}
          testID="editor-plus-server-error"
        >
          {server.status === "missing" ? (
            <TextButton theme={theme} label="Settings" onPress={openSettings} />
          ) : null}
          <TextButton
            theme={theme}
            label={server.status === "ended" ? "Restart" : "Retry"}
            onPress={restart}
          />
        </Banner>
      ) : null}
      <View style={[styles.body, layout.compact ? styles.column : styles.row]}>
        <View style={styles.pane}>
          <View ref={editorHost} style={styles.fill} testID="editor-plus-editor" />
          {fileState === "loading" && !fileError ? <Loading /> : null}
        </View>
        {showPreview ? (
          <View style={[styles.pane, layout.compact ? styles.previewBelow : styles.previewBeside]}>
            <View ref={previewHost} style={styles.fill} testID="editor-plus-preview" />
            {previewLoading ? (
              <View style={styles.overlay}>
                <Loading />
              </View>
            ) : null}
            {previewError ? (
              <View style={styles.overlay}>
                <Text style={styles.error}>{previewError}</Text>
                <TextButton theme={theme} label="Retry" onPress={() => void startPreview()} />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
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
