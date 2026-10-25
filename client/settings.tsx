import type { RpcOutput } from "@getpaseo/plugin";
import {
  type PluginSurfaceProps,
  type SettingsState,
  useRpc,
  useSettings,
} from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { LANGUAGES, type LanguageProfile } from "../shared/languages";
import { serverSettings, serverStatus } from "../shared/rpc";

type Status = RpcOutput<typeof serverStatus>;
type ReadySettings = Extract<SettingsState<typeof serverSettings.schema>, { status: "ready" }>;

const SOURCES: Record<string, string> = {
  setting: "the path set here",
  path: "the daemon's PATH",
  shell: "your login shell's PATH",
  common: "a common install directory",
};

/** One section per language: the server in use, and a path to override it. */
export function EditorPlusSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(serverSettings);
  if (settings.status !== "ready") {
    return (
      <SettingsSection title="Language servers">
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
  return (
    <>
      {LANGUAGES.map((language) => (
        <ServerSection key={language.id} language={language} settings={settings} />
      ))}
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 8 }}>
        Each open editor tab runs its own language server on the daemon host while it is open.
      </Text>
    </>
  );
}

function ServerSection({
  language,
  settings,
}: {
  language: LanguageProfile;
  settings: ReadySettings;
}) {
  const fetchStatus = useRpc(serverStatus);
  const [status, setStatus] = useState<Status | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const { name, binary } = language.server;

  const check = useCallback(() => {
    setStatus(null);
    void fetchStatus({ language: language.id }).then(setStatus, (error: unknown) =>
      setStatus({ path: null, version: null, source: null, error: String(error) }),
    );
  }, [fetchStatus, language.id]);
  useEffect(check, [check]);

  const save = async () => {
    if (draft === null) return;
    const servers = { ...settings.values.servers, [language.id]: { path: draft.trim() } };
    if (await settings.save({ servers }, settings.revision)) {
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
    <SettingsSection title={`${language.title} · ${name}`}>
      <SettingsCard>
        <SettingsRow
          label="In use"
          hint={status?.error ? undefined : found}
          error={status?.error ?? null}
        />
        <SettingsInput
          label={`${name} path`}
          hint="Absolute path on the daemon host. Leave empty to search PATH, your login shell, and common install directories."
          placeholder={`/usr/local/bin/${binary}`}
          initialValue={settings.values.servers[language.id]?.path ?? ""}
          onChangeText={setDraft}
          error={settings.saveError}
        />
        <SettingsAction
          label="Use this path"
          actionLabel={settings.saving ? "Saving…" : "Save"}
          disabled={draft === null || settings.saving}
          onPress={() => void save()}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
