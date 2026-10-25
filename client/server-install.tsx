import type { PluginTheme, RpcOutput } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { installServer, removeServer, serverStatus } from "../shared/rpc";
import { messageOf } from "./connection";

// Installing a language server: the status of the server on the daemon host, the confirmation
// that lists what will be downloaded and where it goes, and progress. Nothing installs without
// the user pressing Install in the confirmation.

export type ServerStatus = RpcOutput<typeof serverStatus>;
type InstallDetails = NonNullable<ServerStatus["install"]>;

/** Status polls this often while an install runs. */
const PROGRESS_POLL_MS = 1000;

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

/** The server status for a language, kept fresh while an install runs. */
export function useServerStatus(language: string) {
  const fetchStatus = useRpc(serverStatus);
  const startInstall = useRpc(installServer);
  const remove = useRpc(removeServer);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchStatus({ language });
      if (alive.current) setStatus(next);
      return next;
    } catch (cause) {
      if (alive.current) setError(messageOf(cause));
      return null;
    }
  }, [fetchStatus, language]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!installing(status)) return;
    const timer = setTimeout(() => void refresh(), PROGRESS_POLL_MS);
    return () => clearTimeout(timer);
  }, [refresh, status]);

  const install = useCallback(async () => {
    setError(null);
    try {
      const result = await startInstall({ language });
      if (!result.started) setError(result.error ?? "The install did not start.");
    } catch (cause) {
      setError(messageOf(cause));
    }
    await refresh();
  }, [language, refresh, startInstall]);

  const uninstall = useCallback(async () => {
    setError(null);
    try {
      await remove({ language });
    } catch (cause) {
      setError(messageOf(cause));
    }
    await refresh();
  }, [language, refresh, remove]);

  return { status, error, refresh, install, uninstall };
}

/** Asks before downloading: what, from where, how big, under what license, and where it goes. */
export function InstallConfirm({
  details,
  open,
  theme,
  onCancel,
  onConfirm,
}: {
  details: InstallDetails | null;
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
    ["Size", details.size === null ? "Depends on the packages" : formatSize(details.size)],
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
          Editor Plus downloads this language server onto the computer that runs the Paseo daemon
          and runs it as your user while you edit. See {details.homepage}.
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
