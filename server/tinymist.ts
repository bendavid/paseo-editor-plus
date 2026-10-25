import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";

export type TinymistSource = "setting" | "path" | "shell" | "common";

export interface TinymistBinary {
  path: string;
  source: TinymistSource;
  version: string | null;
}

const EXE = process.platform === "win32" ? "tinymist.exe" : "tinymist";

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function run(file: string, args: string[], timeout: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true }, (error, stdout) =>
      resolve(error ? null : String(stdout)),
    );
  });
}

async function searchPath(): Promise<string | null> {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir && (await isExecutable(join(dir, EXE)))) return join(dir, EXE);
  }
  return null;
}

/**
 * A daemon started by the desktop app may not have the PATH of your shell, where tools such as
 * cargo and mise put their binaries. Ask a login shell.
 */
async function searchLoginShell(): Promise<string | null> {
  if (process.platform === "win32") return null;
  const shell = process.env.SHELL || "/bin/sh";
  const output = await run(shell, ["-lc", "command -v tinymist"], 5000);
  const path = output?.trim().split("\n").pop()?.trim();
  return path && isAbsolute(path) && (await isExecutable(path)) ? path : null;
}

async function searchCommonDirs(): Promise<string | null> {
  const home = homedir();
  const dirs = [
    join(home, ".cargo", "bin"),
    join(home, ".local", "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/usr/bin",
  ];
  for (const dir of dirs) {
    if (await isExecutable(join(dir, EXE))) return join(dir, EXE);
  }
  return null;
}

/** "tinymist 0.15.10" on release builds; some distribution builds print no version. */
export function parseVersion(output: string | null): string | null {
  const match = /tinymist\s+v?(\d+\.\d+\.\d+[\w.-]*)/i.exec(output ?? "");
  return match ? match[1] : null;
}

export class TinymistNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TinymistNotFoundError";
  }
}

/** Finds tinymist: the configured path, then PATH, a login shell, and common install directories. */
export async function findTinymist(configured: string): Promise<TinymistBinary> {
  let path: string | null = null;
  let source: TinymistSource | null = null;
  const setting = configured.trim();
  if (setting) {
    if (!isAbsolute(setting)) {
      throw new TinymistNotFoundError(`The tinymist path must be absolute: ${setting}`);
    }
    if (!(await isExecutable(setting))) {
      throw new TinymistNotFoundError(
        `The configured tinymist is not an executable file: ${setting}`,
      );
    }
    path = setting;
    source = "setting";
  } else {
    const searches: [TinymistSource, () => Promise<string | null>][] = [
      ["path", searchPath],
      ["shell", searchLoginShell],
      ["common", searchCommonDirs],
    ];
    for (const [where, search] of searches) {
      path = await search();
      if (path) {
        source = where;
        break;
      }
    }
  }
  if (!path || !source) {
    throw new TinymistNotFoundError(
      "tinymist was not found on the daemon host. Install it (for example from " +
        "https://github.com/Myriad-Dreamin/tinymist/releases or your package manager), or set its " +
        "path in the plugin's settings.",
    );
  }
  const version = parseVersion(await run(path, ["--version"], 5000));
  return { path, source, version };
}
