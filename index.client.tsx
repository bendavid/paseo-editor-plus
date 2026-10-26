import type { PluginClientContext, PluginFilePanelProps } from "@getpaseo/plugin/client";
import { Platform } from "react-native";
import { EditorPlusPanel } from "./client/panel";
import { EditorPlusSettings } from "./client/settings";
import { LANGUAGES } from "./shared/languages";

const SETTINGS_ID = "servers";

export default function contribute(client: PluginClientContext) {
  const openSettings = () => client.openSettings(SETTINGS_ID);
  const cleanups = [
    client.addSettingsScreen({
      id: SETTINGS_ID,
      title: "Settings",
      icon: "Settings",
      Component: EditorPlusSettings,
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
  };
}
