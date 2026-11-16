import type { PluginClientContext, PluginFilePanelProps } from "@getpaseo/plugin/client";
import { Platform } from "react-native";
import { EditorPlusPanel } from "./client/panel";
import { setPluginClient } from "./client/plugin-client";
import { DownloadSettings, EditorSettings, ServerSettings } from "./client/settings";
import { LANGUAGES } from "./shared/languages";

/** The settings tab for language servers, which the editor opens when a server is missing. */
const SERVERS_SETTINGS_ID = "servers";

export default function contribute(client: PluginClientContext) {
  setPluginClient(client);
  const openSettings = () => client.openSettings(SERVERS_SETTINGS_ID);
  const cleanups = [
    // Paseo shows several settings screens as tabs, in this order; the first opens by default.
    client.addSettingsScreen({
      id: "editor",
      title: "Editor",
      icon: "SquarePen",
      Component: EditorSettings,
    }),
    client.addSettingsScreen({
      id: SERVERS_SETTINGS_ID,
      title: "Language servers",
      icon: "Server",
      Component: ServerSettings,
    }),
    client.addSettingsScreen({
      id: "downloads",
      title: "Downloads",
      icon: "Download",
      Component: DownloadSettings,
    }),
    // One file panel per language, so Paseo's "Open with" names the language. Only on web (the
    // desktop app and browsers): the editor and previews need the DOM, and on iOS and Android
    // Paseo's own panels (highlighted source, Markdown, PDF) open these files without asking.
    ...(Platform.OS !== "web" ? [] : LANGUAGES).map((language) =>
      client.addFilePanel({
        id: language.id,
        title: language.title,
        icon: language.icon,
        files: { extensions: Object.keys(language.extensions) },
        Component: (props: PluginFilePanelProps) => (
          <EditorPlusPanel {...props} language={language} openSettings={openSettings} />
        ),
      }),
    ),
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
    setPluginClient(null);
  };
}
