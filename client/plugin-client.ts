import type { PluginClientContext } from "@getpaseo/plugin/client";

// The installation's client context, for code outside React that subscribes (a session's
// connection, the LaTeX preview) or reaches an agent's composer. Paseo evaluates the client bundle
// once per installation, so each host's copy of the plugin has its own.

let current: PluginClientContext | null = null;

export function setPluginClient(client: PluginClientContext | null): void {
  current = client;
}

export function pluginClient(): PluginClientContext {
  if (!current) throw new Error("Editor Plus has stopped.");
  return current;
}
