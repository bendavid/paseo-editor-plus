import { type PluginFilePanelProps, useFileText } from "@getpaseo/plugin/client";
import { Loading } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import type { EditorPanelProps } from "./editor-panel";

/**
 * The editor and previews need the DOM, so they run in the desktop and web apps. The iOS and
 * Android apps show the source, read-only, and follow changes on disk.
 */
export function EditorPlusPanel(props: EditorPanelProps) {
  if (props.layout.platform === "web") {
    const { EditorPanel } = require("./editor-panel") as typeof import("./editor-panel");
    return <EditorPanel {...props} />;
  }
  return <ReadOnlySource {...props} />;
}

function ReadOnlySource({ file, theme }: PluginFilePanelProps) {
  const text = useFileText(file);
  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      note: {
        color: theme.colors.foregroundMuted,
        fontSize: 13,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      text: { color: theme.colors.foreground, padding: 16, fontFamily: "monospace", fontSize: 13 },
      error: { color: theme.colors.statusDanger, padding: 16 },
    }),
    [theme],
  );
  return (
    <View style={styles.screen}>
      <Text style={styles.note}>
        Editing and live previews are available in the Paseo desktop and web apps.
      </Text>
      {text.status === "loading" ? <Loading /> : null}
      {text.status === "error" ? <Text style={styles.error}>{text.error.message}</Text> : null}
      {text.status === "ready" ? (
        <ScrollView>
          <Text selectable style={styles.text}>
            {text.text}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}
