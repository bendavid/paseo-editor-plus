import type { PluginTheme, SubscriptionEvent } from "@getpaseo/plugin";
import { useRpc, useSubscription } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/ui";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { installServer, removeServer, serverStatus } from "../shared/rpc";
import { messageOf } from "./connection";

// Installing a language server: the status of the server on the daemon host, the confirmation
// that lists what will be downloaded and where it goes, and progress, which the daemon pushes.
// Nothing installs without the user pressing Install in the confirmation.

export type ServerStatus = SubscriptionEvent<typeof serverStatus>;
export type InstallDetails = NonNullable<ServerStatus["install"]>;

export function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

export function installing(status: ServerStatus | null): boolean {
  const phase = status?.job?.phase;
  return phase === "downloading" || phase === "extracting" || phase === "installing";
}

export function progressText(status: ServerStatus): string {
  const job = status.job;
  const name = status.install?.name ?? "the server";
  if (!job) return "";
  switch (job.phase) {
    case "downloading":
      return job.total
        ? `Downloading ${name}… ${formatSize(job.received)} of ${formatSize(job.total)}`
        : `Downloading ${name}…`;
    case "extracting":
      return `Unpacking ${name}…`;
    case "installing":
      return `Installing ${name}…`;
    case "done":
      return `Installed ${name}.`;
    case "failed":
      return `Installing ${name} failed: ${job.error ?? "unknown error"}`;
  }
}

/** The server status for a language, as the daemon reports it and its install's progress. */
export function useServerStatus(language: string) {
  const startInstall = useRpc(installServer);
  const remove = useRpc(removeServer);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const subscription = useSubscription(serverStatus, { language }, setStatus);

  const install = useCallback(async () => {
    setError(null);
    try {
      const result = await startInstall({ language });
      if (!result.started) setError(result.error ?? "The install did not start.");
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, [language, startInstall]);

  const uninstall = useCallback(async () => {
    setError(null);
    try {
      await remove({ language });
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, [language, remove]);

  return {
    status,
    error: error ?? (subscription.status === "error" ? subscription.error.message : null),
    install,
    uninstall,
  };
}

/** Asks before downloading: what, from where, how big, under what license, and where it goes. */
export function InstallConfirm({
  details,
  description,
  approximateSize,
  open,
  theme,
  onCancel,
  onConfirm,
}: {
  details: InstallDetails | null;
  /** Replaces the language-server explanation. */
  description?: string;
  /** The size is roughly what it takes once installed, not the download. */
  approximateSize?: boolean;
  open: boolean;
  theme: PluginTheme;
  onCancel(): void;
  onConfirm(): void;
}) {
  if (!details) return null;
  const text = { color: theme.colors.foreground, fontSize: 14, lineHeight: 20 };
  const muted = { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 18 };
  const rows: [string, string][] = [
    ["From", details.source],
    [
      approximateSize ? "Size once installed" : "Size",
      details.size === null
        ? "Depends on the packages"
        : `${approximateSize ? "About " : ""}${formatSize(details.size)}`,
    ],
    ["License", details.license],
    ["Into", details.destination],
  ];
  if (details.needs)
    rows.push([
      "Needs",
      details.needs === "go" ? "Go on the daemon host" : "npm on the daemon host",
    ]);
  return (
    <Modal
      title={`Install ${details.name} ${details.version}?`}
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <Modal.Content>
        <Text style={text}>
          {description ??
            `Editor Plus downloads this language server onto the computer that runs the Paseo daemon and runs it as your user while you edit. See ${details.homepage}.`}
        </Text>
        {rows.map(([label, value]) => (
          <View key={label} style={{ gap: 2 }}>
            <Text style={muted}>{label}</Text>
            <Text selectable style={text}>
              {value}
            </Text>
          </View>
        ))}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 8 }}>
          <DialogButton theme={theme} label="Cancel" onPress={onCancel} />
          <DialogButton theme={theme} label="Install" primary onPress={onConfirm} />
        </View>
      </Modal.Content>
    </Modal>
  );
}

function DialogButton({
  theme,
  label,
  primary,
  onPress,
}: {
  theme: PluginTheme;
  label: string;
  primary?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: primary ? theme.colors.accent : theme.colors.surface2,
      }}
    >
      <Text
        style={{
          color: primary ? theme.colors.accentForeground : theme.colors.foreground,
          fontSize: 14,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
