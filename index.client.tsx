import type { PluginClientContext } from "@getpaseo/plugin/client";
import { TypstPanel } from "./client/panel";
import { TypstSettings } from "./client/settings";

const SETTINGS_ID = "tinymist";

export default function contribute(client: PluginClientContext) {
  const openSettings = () => client.openSettings(SETTINGS_ID);
  const removeSettings = client.addSettingsScreen({
    id: SETTINGS_ID,
    title: "Typst",
    icon: "FileCode",
    Component: TypstSettings,
  });
  const removePanel = client.addFilePanel({
    id: "typst",
    title: "Typst",
    icon: "FileCode",
    files: { extensions: ["typ"] },
    Component: (props) => <TypstPanel {...props} openSettings={openSettings} />,
  });
  return () => {
    removePanel();
    removeSettings();
  };
}
