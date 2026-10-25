/** The response to `tinymist.doStartPreview` names the port of the preview's page and WebSocket. */
export function tinymistPreviewPorts(message: string): number[] {
  if (!message.includes('"dataPlanePort"')) return [];
  try {
    const port = (JSON.parse(message) as { result?: { dataPlanePort?: unknown } }).result
      ?.dataPlanePort;
    return typeof port === "number" ? [port] : [];
  } catch {
    return [];
  }
}
