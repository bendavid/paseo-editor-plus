import type { PreviewProvider } from "./types";

// tinymist's preview, started by its language server. See tinymist's editors/vscode for the
// reference client: `tinymist.doStartPreview` returns the data plane port, the editor reports
// cursor positions with `tinymist.scrollPreview`, and clicks in the preview come back as
// `tinymist/preview/scrollSource` once `customizedShowDocument` is set. The page and its
// WebSocket travel through the session (see client/web/preview.ts).

interface ScrollSource {
  filepath: string;
  start: [number, number] | null;
  end: [number, number] | null;
}

export const tinymistPreview: PreviewProvider = {
  needsServer: true,

  async start(services) {
    const { client, session, filePath, calls, web } = services;
    if (!client || !session) throw new Error("tinymist is not running.");
    const command = (name: string, args: unknown[]) =>
      client.request("workspace/executeCommand", { command: name, arguments: args });
    const task = `paseo-${Math.random().toString(36).slice(2, 10)}`;
    const started = (await command("tinymist.doStartPreview", [
      [
        "--task-id",
        task,
        "--data-plane-host",
        "127.0.0.1:0",
        // The panel inverts colours itself.
        "--invert-colors=never",
        "--partial-rendering=true",
        "--no-open",
        filePath,
      ],
    ])) as { dataPlanePort?: number } | null;
    const port = started?.dataPlanePort;
    if (!port) throw new Error("tinymist did not start a preview.");
    const stop = () => void command("tinymist.doKillPreview", [task]).catch(() => {});
    let html: string | null;
    try {
      ({ html } = await calls.connectPreview({ sessionId: session.id, port, includeHtml: true }));
    } catch (error) {
      stop();
      throw error;
    }
    if (!html) {
      stop();
      throw new Error("tinymist's preview page is empty.");
    }
    const view = web.mountPreview(
      services.parent,
      html,
      {
        reconnect: async () => {
          await calls.connectPreview({ sessionId: session.id, port, includeHtml: false });
        },
        send: (message) => session.sendPreview(message),
      },
      {
        invert: services.invert,
        background: services.theme.colors.surface1,
        invertTarget: "#typst-app",
      },
    );
    return {
      deliver: (frame) => view.deliver(frame),
      reveal(position) {
        void command("tinymist.scrollPreview", [
          task,
          // tinymist's preview counts columns in characters, as the editor's positions do.
          { event: "panelScrollTo", filepath: filePath, ...position },
        ]).catch(() => {});
      },
      textChanged() {},
      saved() {},
      setInvert: (invert) => view.setInvert(invert),
      setTheme: (theme) => view.setBackground(theme.colors.surface1),
      destroy() {
        view.destroy();
        stop();
      },
    };
  },

  sourceJump(method, params) {
    if (method !== "tinymist/preview/scrollSource") return null;
    const jump = params as ScrollSource;
    if (!jump.start) return null;
    return {
      path: jump.filepath,
      start: { line: jump.start[0], character: jump.start[1] },
      end: jump.end ? { line: jump.end[0], character: jump.end[1] } : null,
    };
  },

  swallows(method) {
    // The document outline and the preview's window state.
    return method.startsWith("tinymist/");
  },
};
