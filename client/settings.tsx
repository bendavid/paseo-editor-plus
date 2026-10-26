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
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text } from "react-native";
import { LANGUAGES, type LanguageProfile } from "../shared/languages";
import { COMPONENTS, type ComponentId } from "../shared/components";
import { AUTO_SAVE_MAX_MS, AUTO_SAVE_MIN_MS, removeComponent, serverSettings } from "../shared/rpc";
import { componentDescription, componentDetails, useComponent } from "./component-install";
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
      <EditorSection settings={settings} />
      {LANGUAGES.map((language) => (
        <ServerSection key={language.id} language={language} settings={settings} theme={theme} />
      ))}
      <SettingsSection title="Downloads">
        <SettingsCard>
          <ComponentRow id="spelling" theme={theme} />
          <ComponentRow id="pdfjs" theme={theme} />
        </SettingsCard>
      </SettingsSection>
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
      {
        ...settings.values,
        servers: { ...settings.values.servers, [language.id]: { ...entry, ...change } },
      },
      settings.revision,
    );

  const save = async () => {
    if (draft === null) return;
    const servers = {
      ...settings.values.servers,
      [language.id]: { ...entry, path: draft.trim() },
    };
    if (await settings.save({ ...settings.values, servers }, settings.revision)) {
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

/** A component Editor Plus downloads when asked: where it is, and ways to install or remove it. */
function ComponentRow({ id, theme }: { id: ComponentId; theme: PluginSurfaceProps["theme"] }) {
  const { status, error, refresh, install } = useComponent(id);
  const remove = useRpc(removeComponent);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const info = COMPONENTS[id];
  const label = `${info.name} ${info.version}`;
  let row;
  if (status?.state === "ready") {
    row = (
      <SettingsAction
        label={label}
        hint={`${info.purpose} Downloaded to ${status.folder}. ${info.license}.`}
        actionLabel={busy ? "Removing…" : "Remove"}
        disabled={busy}
        onPress={() => {
          setBusy(true);
          void remove({ id })
            .then(refresh)
            .finally(() => setBusy(false));
        }}
      />
    );
  } else if (status?.state === "installing") {
    row = <SettingsRow label={label} hint="Downloading…" />;
  } else {
    row = (
      <SettingsAction
        label={label}
        hint={`${info.purpose} Downloaded from npm when you install it. ${info.license}.`}
        actionLabel="Install…"
        disabled={!status}
        onPress={() => setConfirming(true)}
      />
    );
  }
  return (
    <>
      {row}
      {error || status?.state === "failed" ? (
        <SettingsRow label={label} error={error ?? status?.error ?? null} />
      ) : null}
      {status ? (
        <InstallConfirm
          details={componentDetails(id, status.destination)}
          description={componentDescription(id)}
          approximateSize
          open={confirming}
          theme={theme}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void install();
          }}
        />
      ) : null}
    </>
  );
}

/** Saving: automatically after a delay, as Paseo's own editor does, or with Ctrl/Cmd+S. */
function EditorSection({ settings }: { settings: ReadySettings }) {
  const [draft, setDraft] = useState<string | null>(null);
  const delay = draft === null ? null : Number(draft.trim());
  const valid =
    delay !== null &&
    Number.isInteger(delay) &&
    delay >= AUTO_SAVE_MIN_MS &&
    delay <= AUTO_SAVE_MAX_MS;
  const saveDelay = async () => {
    if (!valid || delay === null) return;
    if (await settings.save({ ...settings.values, autoSaveDelayMs: delay }, settings.revision)) {
      setDraft(null);
    }
  };
  return (
    <SettingsSection title="Editor">
      <SettingsCard>
        <SettingsSwitch
          label="Save automatically"
          hint="Saves each file shortly after you stop typing, as Paseo's own editor does. When off, Ctrl/Cmd+S saves, and unsaved edits stay with the tab until you save or close it."
          value={settings.values.autoSave}
          disabled={settings.saving}
          onValueChange={(autoSave) =>
            void settings.save({ ...settings.values, autoSave }, settings.revision)
          }
        />
        <SettingsInput
          label="Auto-save delay (ms)"
          hint={`How long after the last edit to save; ${AUTO_SAVE_MIN_MS} to ${AUTO_SAVE_MAX_MS}. Paseo's editor uses 800.`}
          placeholder="800"
          initialValue={String(settings.values.autoSaveDelayMs)}
          onChangeText={setDraft}
          disabled={!settings.values.autoSave}
          error={
            draft !== null && !valid
              ? `Enter a whole number from ${AUTO_SAVE_MIN_MS} to ${AUTO_SAVE_MAX_MS}.`
              : null
          }
        />
        <SettingsAction
          label="Use this delay"
          actionLabel={settings.saving ? "Saving…" : "Save"}
          disabled={!valid || settings.saving || !settings.values.autoSave}
          onPress={() => void saveDelay()}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
