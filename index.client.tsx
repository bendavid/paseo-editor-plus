import type { PluginClientContext, PluginFilePanelProps } from "@getpaseo/plugin/client";
import { EditorPlusPanel } from "./client/panel";
import { EditorPlusSettings } from "./client/settings";
import { LANGUAGES } from "./shared/languages";

const SETTINGS_ID = "servers";

export default function contribute(client: PluginClientContext) {
  const openSettings = () => client.openSettings(SETTINGS_ID);
  const cleanups = [
    client.addSettingsScreen({
      id: SETTINGS_ID,
      title: "Language servers",
      icon: "Server",
      Component: EditorPlusSettings,
    }),
    // One file panel per language, so Paseo's "Open with" names the language.
    ...LANGUAGES.map((language) =>
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
