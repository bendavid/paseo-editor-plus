import { type PluginFilePanelProps, useFileText } from "@getpaseo/plugin/client";
import { Loading } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import type { TypstEditorPanelProps } from "./editor-panel";

/**
 * The editor and preview need the DOM, so they run in the desktop and web apps. The iOS and
 * Android apps show the source, read-only, and follow changes on disk.
 */
export function TypstPanel(props: TypstEditorPanelProps) {
  if (props.layout.platform === "web") {
    const { TypstEditorPanel } = require("./editor-panel") as typeof import("./editor-panel");
    return <TypstEditorPanel {...props} />;
  }
  return <TypstSource {...props} />;
}

function TypstSource({ file, theme }: PluginFilePanelProps) {
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
        Editing and the live preview are available in the Paseo desktop and web apps.
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
