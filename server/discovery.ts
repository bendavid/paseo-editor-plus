import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";

// Finds a language server's executable on the daemon host: the path in settings, then one the
// plugin installed, then PATH, a login shell's PATH, and common install directories.

export type ServerSource = "setting" | "installed" | "path" | "shell" | "common";

/** How to run a server: the executable, arguments before the server's own, and environment. */
export interface Launch {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ServerBinary {
  path: string;
  source: ServerSource;
  version: string | null;
  launch: Launch;
}

export interface ServerQuery {
  /** The executable's name, such as "tinymist". */
  binary: string;
  /** A path from settings; empty to search. */
  configured: string;
  homepage: string;
  /** A copy the plugin installed, if any. */
  installed?: () => Promise<{ launch: Launch; version: string; path: string } | null>;
}

const exe = (binary: string) => (process.platform === "win32" ? `${binary}.exe` : binary);

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

async function searchPath(binary: string): Promise<string | null> {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir && (await isExecutable(join(dir, exe(binary))))) return join(dir, exe(binary));
  }
  return null;
}

/**
 * A daemon started by the desktop app may not have the PATH of your shell, where tools such as
 * cargo and mise put their binaries. Ask a login shell.
 */
async function searchLoginShell(binary: string): Promise<string | null> {
  if (process.platform === "win32" || !/^[\w.-]+$/.test(binary)) return null;
  const shell = process.env.SHELL || "/bin/sh";
  const output = await run(shell, ["-lc", `command -v ${binary}`], 5000);
  const path = output?.trim().split("\n").pop()?.trim();
  return path && isAbsolute(path) && (await isExecutable(path)) ? path : null;
}

async function searchCommonDirs(binary: string): Promise<string | null> {
  const home = homedir();
  const dirs = [
    join(home, ".cargo", "bin"),
    join(home, ".local", "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/usr/bin",
  ];
  for (const dir of dirs) {
    if (await isExecutable(join(dir, exe(binary)))) return join(dir, exe(binary));
  }
  return null;
}

/**
 * The version in `--version` output, such as "tinymist 0.15.10". Only a number after the binary's
 * own name counts: some builds print none, and the output names other tools' versions too.
 */
export function parseVersion(binary: string, output: string | null): string | null {
  const name = binary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${name}\\s+v?(\\d+\\.\\d+\\.\\d+[\\w.-]*)`, "im").exec(output ?? "");
  return match ? match[1] : null;
}

export class ServerNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerNotFoundError";
  }
}

/** The configured path, else PATH, a login shell, and common install directories. */
export async function findServer({
  binary,
  configured,
  homepage,
  installed,
}: ServerQuery): Promise<ServerBinary> {
  let path: string | null = null;
  let source: ServerSource | null = null;
  const setting = configured.trim();
  if (setting) {
    if (!isAbsolute(setting)) {
      throw new ServerNotFoundError(`The ${binary} path must be absolute: ${setting}`);
    }
    if (!(await isExecutable(setting))) {
      throw new ServerNotFoundError(
        `The configured ${binary} is not an executable file: ${setting}`,
      );
    }
    path = setting;
    source = "setting";
  } else {
    const own = await installed?.();
    if (own)
      return { path: own.path, source: "installed", version: own.version, launch: own.launch };
    const searches: [ServerSource, (binary: string) => Promise<string | null>][] = [
      ["path", searchPath],
      ["shell", searchLoginShell],
      ["common", searchCommonDirs],
    ];
    for (const [where, search] of searches) {
      path = await search(binary);
      if (path) {
        source = where;
        break;
      }
    }
  }
  if (!path || !source) {
    throw new ServerNotFoundError(
      `${binary} is not installed on the daemon host. Install it here, from ${homepage}, or set ` +
        "its path in the plugin's settings.",
    );
  }
  const version = parseVersion(binary, await run(path, ["--version"], 5000));
  return { path, source, version, launch: { command: path, args: [] } };
}
