import type { EditorPanelProps } from "./editor-panel";

/**
 * The file panel, registered on web only (index.client.tsx). The editor's module is loaded when
 * the panel first renders, not when the plugin starts.
 */
export function EditorPlusPanel(props: EditorPanelProps) {
  const { EditorPanel } = require("./editor-panel") as typeof import("./editor-panel");
  return <EditorPanel {...props} />;
}
