import basedpyrightLock from "./npm/basedpyright/package-lock.json";
import basedpyright from "./npm/basedpyright/package.json";
import typescriptLock from "./npm/typescript-language-server/package-lock.json";
import typescript from "./npm/typescript-language-server/package.json";
import vscodeLock from "./npm/vscode-langservers-extracted/package-lock.json";
import vscode from "./npm/vscode-langservers-extracted/package.json";
import pdfjsLock from "./npm/pdfjs/package-lock.json";
import pdfjs from "./npm/pdfjs/package.json";
import spellingLock from "./npm/spelling/package-lock.json";
import spelling from "./npm/spelling/package.json";

// The npm servers' and components' manifests and lockfiles, embedded in the server bundle: Paseo runs it outside
// the plugin's folder. The installer writes them out and runs `npm ci --ignore-scripts`, so the
// installed tree is exactly the locked one. Update with `npm install --package-lock-only` in the
// package's folder.

const files = (manifest: unknown, lock: unknown) => ({
  manifest: `${JSON.stringify(manifest, null, 2)}\n`,
  lock: `${JSON.stringify(lock, null, 2)}\n`,
});

export const NPM_PACKAGES: Readonly<Record<string, { manifest: string; lock: string }>> = {
  basedpyright: files(basedpyright, basedpyrightLock),
  "typescript-language-server": files(typescript, typescriptLock),
  "vscode-langservers-extracted": files(vscode, vscodeLock),
};

/** Components the plugin itself loads from plugin-data (server/components.ts). */
export const NPM_COMPONENTS = {
  pdfjs: files(pdfjs, pdfjsLock),
  spelling: files(spelling, spellingLock),
} as const;
