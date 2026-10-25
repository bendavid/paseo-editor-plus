import type { RpcOutput } from "@getpaseo/plugin";
import { type PluginSurfaceProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { tinymistSettings, tinymistStatus } from "../shared/rpc";

type Status = RpcOutput<typeof tinymistStatus>;

const SOURCES: Record<string, string> = {
  setting: "the path set here",
  path: "the daemon's PATH",
  shell: "your login shell's PATH",
  common: "a common install directory",
};

export function TypstSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(tinymistSettings);
  const fetchStatus = useRpc(tinymistStatus);
  const [status, setStatus] = useState<Status | null>(null);
  const [draft, setDraft] = useState<string | null>(null);

  const check = useCallback(() => {
    setStatus(null);
    void fetchStatus({}).then(setStatus, (error: unknown) =>
      setStatus({ path: null, version: null, source: null, error: String(error) }),
    );
  }, [fetchStatus]);
  useEffect(check, [check]);

  if (settings.status !== "ready") {
    return (
      <SettingsSection title="tinymist">
        <SettingsCard>
          <SettingsRow
            label="Settings"
            hint={settings.status === "loading" ? "Loading…" : undefined}
            error={"error" in settings ? settings.error : null}
          />
        </SettingsCard>
      </SettingsSection>
    );
  }
  const saveDraft = async () => {
    if (draft === null) return;
    if (await settings.save({ tinymistPath: draft.trim() }, settings.revision)) {
      setDraft(null);
      check();
    }
  };
  let found = "Checking…";
  if (status?.path) {
    const version = status.version ? ` (${status.version})` : "";
    found = `${status.path}${version}, from ${SOURCES[status.source ?? ""] ?? "unknown"}`;
  }
  return (
    <SettingsSection title="tinymist">
      <SettingsCard>
        <SettingsRow
          label="In use"
          hint={status?.error ? undefined : found}
          error={status?.error ?? null}
        >
          {null}
        </SettingsRow>
        <SettingsInput
          label="tinymist path"
          hint="Absolute path on the daemon host. Leave empty to search PATH, your login shell, and common install directories."
          placeholder="/usr/local/bin/tinymist"
          initialValue={settings.values.tinymistPath}
          onChangeText={setDraft}
          error={settings.saveError}
        />
        <SettingsAction
          label="Use this path"
          actionLabel={settings.saving ? "Saving…" : "Save"}
          disabled={draft === null || settings.saving}
          onPress={() => void saveDraft()}
        />
      </SettingsCard>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 8 }}>
        Each open Typst tab runs its own tinymist on the daemon host while it is open.
      </Text>
    </SettingsSection>
  );
}
