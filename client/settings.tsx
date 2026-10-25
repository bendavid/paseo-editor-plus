import { type PluginSurfaceProps, type SettingsState, useSettings } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text } from "react-native";
import { LANGUAGES, type LanguageProfile } from "../shared/languages";
import { serverSettings } from "../shared/rpc";
import { InstallConfirm, installing, progressText, useServerStatus } from "./server-install";

type ReadySettings = Extract<SettingsState<typeof serverSettings.schema>, { status: "ready" }>;

const SOURCES: Record<string, string> = {
  setting: "the path set here",
  installed: "the copy Editor Plus installed",
  path: "the daemon's PATH",
  shell: "your login shell's PATH",
  common: "a common install directory",
};

/** One section per language: the server in use, and a path to override it. */
export function EditorPlusSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(serverSettings);
  if (settings.status !== "ready") {
    return (
      <SettingsSection title="Settings">
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
        <ServerSection key={language.id} language={language} settings={settings} theme={theme} />
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
  theme,
}: {
  language: LanguageProfile;
  settings: ReadySettings;
  theme: PluginSurfaceProps["theme"];
}) {
  const { status, error, refresh, install, uninstall } = useServerStatus(language.id);
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const { name, binary } = language.server;
  const entry = settings.values.servers[language.id] ?? { path: "", compileOnSave: false };
  const update = (change: Partial<typeof entry>) =>
    void settings.save(
      { servers: { ...settings.values.servers, [language.id]: { ...entry, ...change } } },
      settings.revision,
    );

  const save = async () => {
    if (draft === null) return;
    const servers = {
      ...settings.values.servers,
      [language.id]: { ...entry, path: draft.trim() },
    };
    if (await settings.save({ servers }, settings.revision)) {
      setDraft(null);
      void refresh();
    }
  };
  let found = "Checking…";
  if (status?.path) {
    const version = status.version ? ` (${status.version})` : "";
    found = `${status.path}${version}, from ${SOURCES[status.source ?? ""] ?? "unknown"}`;
  }
  const busy = installing(status);
  const offer = status?.install ?? null;
  const own = status?.installed ?? null;
  let installLabel: string | null = null;
  // Settings always offer the plugin's own pinned copy; the editor asks only when none is found.
  if (offer && !own)
    installLabel = status?.path ? `Install managed ${offer.version}` : `Install ${offer.version}`;
  else if (offer && own && own.version !== offer.version)
    installLabel = `Update to ${offer.version}`;
  return (
    <SettingsSection title={`${language.title} · ${name}`}>
      <SettingsCard>
        <SettingsRow
          label="In use"
          hint={status?.error ? undefined : found}
          error={status?.error ?? null}
        />
        {own ? (
          <SettingsAction
            label={`Installed by Editor Plus: ${own.version}`}
            hint={own.folder}
            actionLabel="Remove"
            disabled={busy}
            onPress={() => void uninstall()}
          />
        ) : null}
        {installLabel && offer ? (
          <SettingsAction
            label={`Install ${offer.name} here`}
            hint={
              status?.path && !own
                ? `A pinned copy managed by Editor Plus, used instead of the one found. ${offer.license}.`
                : `${offer.license}. Asks before downloading.`
            }
            actionLabel={busy ? "Installing…" : installLabel}
            disabled={busy}
            onPress={() => setConfirming(true)}
          />
        ) : null}
        {!offer && status?.installUnavailable && !status.path ? (
          <SettingsRow label="Install" hint={status.installUnavailable} />
        ) : null}
        {status?.job && status.job.phase !== "done" ? (
          <SettingsRow
            label="Progress"
            hint={status.job.phase === "failed" ? undefined : progressText(status)}
            error={status.job.phase === "failed" ? progressText(status) : null}
          />
        ) : null}
        {error ? <SettingsRow label="Install" error={error} /> : null}
        {language.compile ? (
          <SettingsSwitch
            label="Compile to PDF on save"
            hint={
              language.id === "latex"
                ? "Runs latexmk with SyncTeX beside the root document each time the file is saved."
                : "Writes the PDF beside the file each time it is saved."
            }
            value={entry.compileOnSave}
            disabled={settings.saving}
            onValueChange={(compileOnSave) => update({ compileOnSave })}
          />
        ) : null}
        <SettingsSwitch
          label="Check spelling"
          hint={
            language.spellcheck
              ? "Underlines misspelled words in text and comments, skipping code, math, and references."
              : "Underlines misspelled words in comments."
          }
          value={entry.spellcheck ?? language.spellcheck}
          disabled={settings.saving}
          onValueChange={(spellcheck) => update({ spellcheck })}
        />
        <SettingsInput
          label={`${name} path`}
          hint="Absolute path on the daemon host. Leave empty to use the installed copy or search PATH, your login shell, and common install directories."
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
      <InstallConfirm
        details={offer}
        open={confirming}
        theme={theme}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void install();
        }}
      />
    </SettingsSection>
  );
}
