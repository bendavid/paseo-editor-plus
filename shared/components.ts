// Parts of Editor Plus downloaded the first time they are needed, rather than shipped in the
// plugin: Paseo runs the plugin's server code without a way to find files in its own folder, so
// anything the server reads at run time lives in plugin-data/editor-plus/components/<id>/<version>/.
// Each installs from a lockfile in server/npm/<id>/ with `npm ci --ignore-scripts`.

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
}

export const COMPONENTS: Readonly<Record<ComponentId, ComponentInfo>> = {
  pdfjs: {
    id: "pdfjs",
    name: "PDF.js",
    version: "6.4.299",
    license: "Apache-2.0",
    homepage: "https://mozilla.github.io/pdf.js/",
    purpose: "Shows the LaTeX preview.",
  },
  spelling: {
    id: "spelling",
    name: "cspell",
    version: "10.4.0",
    license: "MIT (dictionaries: MIT, BSD, and others; see each @cspell/dict package)",
    homepage: "https://cspell.org",
    purpose: "Checks spelling, with English and technical dictionaries.",
  },
};

export type ComponentState = "ready" | "missing" | "installing" | "failed";

export interface ComponentStatus {
  id: ComponentId;
  state: ComponentState;
  version: string;
  /** The installed folder on the daemon host, when ready. */
  folder: string | null;
  error: string | null;
}

/** What to show while a component is not ready, or null when it is. */
export function componentMessage(status: ComponentStatus): string | null {
  const { name, version } = COMPONENTS[status.id];
  switch (status.state) {
    case "ready":
      return null;
    case "missing":
    case "installing":
      return `Downloading ${name} ${version} (first use only)…`;
    case "failed":
      return `Could not download ${name}: ${status.error ?? "unknown error"}`;
  }
}
