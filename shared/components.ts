// Parts of Editor Plus downloaded when first needed, rather than shipped in the
// plugin: Paseo runs the plugin's server code without a way to find files in its own folder, so
// anything the server reads at run time lives in plugin-data/editor-plus/components/<id>/<version>/.
// Each installs from a lockfile in server/npm/<id>/ with `npm ci --ignore-scripts`, after the user
// confirms it, as language servers do.

export type ComponentId = "pdfjs" | "spelling";

export interface ComponentInfo {
  id: ComponentId;
  name: string;
  /** The version of the main package; names the install folder. Matches server/npm/<id>/. */
  version: string;
  license: string;
  homepage: string;
  /** What it is for, shown in the settings. */
  purpose: string;
  /** What needs it, for the editor's banner: "The LaTeX preview needs …". */
  neededBy: string;
  /** What is downloaded, shown before installing. */
  source: string;
  /** About how much it takes once installed, in bytes. */
  installedSize: number;
}

export const COMPONENTS: Readonly<Record<ComponentId, ComponentInfo>> = {
  pdfjs: {
    id: "pdfjs",
    name: "PDF.js",
    version: "6.4.299",
    license: "Apache-2.0",
    homepage: "https://mozilla.github.io/pdf.js/",
    purpose: "Shows the LaTeX preview.",
    neededBy: "The LaTeX preview",
    source: "npm: pdfjs-dist@6.4.299",
    installedSize: 35_000_000,
  },
  spelling: {
    id: "spelling",
    name: "cspell",
    version: "10.4.0",
    license: "MIT (dictionaries: MIT, BSD, and others; see each @cspell/dict package)",
    homepage: "https://cspell.org",
    purpose: "Checks spelling, with English and technical dictionaries.",
    neededBy: "Spellchecking",
    source: "npm: cspell-lib@10.4.0 and the 94 packages it depends on, its dictionaries among them",
    installedSize: 9_000_000,
  },
};

export type ComponentState = "ready" | "missing" | "installing" | "failed";

export interface ComponentStatus {
  id: ComponentId;
  state: ComponentState;
  version: string;
  /** The installed folder on the daemon host, when ready. */
  folder: string | null;
  /** Where it installs. */
  destination: string;
  error: string | null;
}

/** What to show while a component is not ready, or null when it is. */
export function componentMessage(
  status: Pick<ComponentStatus, "id" | "state" | "error">,
): string | null {
  const { name, version } = COMPONENTS[status.id];
  switch (status.state) {
    case "ready":
      return null;
    case "missing":
      return `${name} ${version} is not installed`;
    case "installing":
      return `Downloading ${name} ${version}…`;
    case "failed":
      return `Could not download ${name}: ${status.error ?? "unknown error"}`;
  }
}
