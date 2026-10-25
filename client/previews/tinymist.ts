import type { PreviewProvider } from "./types";

// tinymist's preview, started by its language server. See tinymist's editors/vscode for the
// reference client: `tinymist.doStartPreview` returns the data plane port, the editor reports
// cursor positions with `tinymist.scrollPreview`, and clicks in the preview come back as
// `tinymist/preview/scrollSource` once `customizedShowDocument` is set.

interface ScrollSource {
  filepath: string;
  start: [number, number] | null;
  end: [number, number] | null;
}

export const tinymistPreview: PreviewProvider = {
  invertTarget: "#typst-app",

  async start({ command, filePath }) {
    const task = `paseo-${Math.random().toString(36).slice(2, 10)}`;
    const started = (await command("tinymist.doStartPreview", [
      [
        "--task-id",
        task,
        "--data-plane-host",
        "127.0.0.1:0",
        // The panel inverts colours itself, following the app's theme.
        "--invert-colors=never",
        "--partial-rendering=true",
        "--no-open",
        filePath,
      ],
    ])) as { dataPlanePort?: number } | null;
    const port = started?.dataPlanePort;
    if (!port) throw new Error("tinymist did not start a preview.");
    return { task, port };
  },

  async stop({ command }, task) {
    await command("tinymist.doKillPreview", [task]);
  },

  async reveal({ command, filePath }, task, position) {
    await command("tinymist.scrollPreview", [
      task,
      // tinymist's preview counts columns in characters, as the editor's positions do.
      { event: "panelScrollTo", filepath: filePath, ...position },
    ]);
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
