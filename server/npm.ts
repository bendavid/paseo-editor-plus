import basedpyrightLock from "./npm/basedpyright/package-lock.json";
import basedpyright from "./npm/basedpyright/package.json";
import typescriptLock from "./npm/typescript-language-server/package-lock.json";
import typescript from "./npm/typescript-language-server/package.json";
import vscodeLock from "./npm/vscode-langservers-extracted/package-lock.json";
import vscode from "./npm/vscode-langservers-extracted/package.json";

// The npm servers' manifests and lockfiles, embedded in the server bundle: Paseo runs it outside
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
