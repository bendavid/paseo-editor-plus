// The language servers Editor Plus can install on request, each pinned to one version. Release
// downloads are pinned with GitHub's SHA-256 digests (scripts/update-servers.mjs writes them to
// server-releases.ts). npm servers install from a lockfile shipped in server/npm/<id>/ with
// `npm ci --ignore-scripts`. gopls installs with `go install`, which checks the Go checksum
// database. Nothing installs without the user confirming it.

export type Platform =
  "linux-x64" | "linux-arm64" | "darwin-x64" | "darwin-arm64" | "win32-x64" | "win32-arm64";

export interface ReleaseAsset {
  url: string;
  size: number;
  sha256: string;
}

export type ReleaseServers = Record<
  string,
  { version: string; repo: string; platforms: Partial<Record<Platform, ReleaseAsset>> }
>;

export type InstallMethod =
  /** A GitHub release asset: an archive (.tar.gz, .zip), a gzipped binary (.gz), or a binary. */
  | { kind: "release"; repo: string }
  /** npm packages from the lockfile in server/npm/<package id>/. */
  | { kind: "npm"; packages: string }
  /** `go install <module>@v<version>`; needs Go on the daemon host. */
  | { kind: "go"; module: string };

export interface ServerPackage {
  /** Names the install folder: plugin-data/editor-plus/servers/<id>/<version>/. */
  id: string;
  /** Shown in prompts, such as "basedpyright". */
  name: string;
  version: string;
  homepage: string;
  license: string;
  install: InstallMethod;
}

/** npm and Go servers. Release servers come from server-releases.ts. */
export const PACKAGES: readonly ServerPackage[] = [
  {
    id: "basedpyright",
    name: "basedpyright",
    version: "1.40.2",
    homepage: "https://github.com/DetachHead/basedpyright",
    license: "MIT",
    install: { kind: "npm", packages: "basedpyright@1.40.2" },
  },
  {
    id: "typescript-language-server",
    name: "typescript-language-server",
    version: "6.0.2",
    homepage: "https://github.com/typescript-language-server/typescript-language-server",
    license: "Apache-2.0 (with TypeScript, Apache-2.0)",
    install: { kind: "npm", packages: "typescript-language-server@6.0.2 typescript@5.9.3" },
  },
  {
    id: "vscode-langservers-extracted",
    name: "vscode-langservers-extracted",
    version: "4.10.0",
    homepage: "https://github.com/hrsh7th/vscode-langservers-extracted",
    license: "MIT",
    install: { kind: "npm", packages: "vscode-langservers-extracted@4.10.0" },
  },
  {
    id: "gopls",
    name: "gopls",
    version: "0.24.0",
    homepage: "https://go.dev/gopls",
    license: "BSD-3-Clause",
    install: { kind: "go", module: "golang.org/x/tools/gopls" },
  },
];

/** Release servers' names, homepages, and licenses; versions and assets are generated. */
export const RELEASE_INFO: Readonly<
  Record<string, { name: string; homepage: string; license: string }>
> = {
  tinymist: {
    name: "tinymist",
    homepage: "https://github.com/Myriad-Dreamin/tinymist",
    license: "Apache-2.0",
  },
  "rust-analyzer": {
    name: "rust-analyzer",
    homepage: "https://rust-analyzer.github.io",
    license: "MIT OR Apache-2.0",
  },
  clangd: {
    name: "clangd",
    homepage: "https://clangd.llvm.org",
    license: "Apache-2.0 WITH LLVM-exception",
  },
  texlab: { name: "texlab", homepage: "https://github.com/latex-lsp/texlab", license: "MIT" },
  marksman: {
    name: "marksman",
    homepage: "https://github.com/artempyanykh/marksman",
    license: "MIT",
  },
};
