import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { RELEASES } from "../shared/server-releases";
import { PACKAGES, type Platform, RELEASE_INFO, type ServerPackage } from "../shared/servers";
import type { Launch } from "./discovery";
import { NPM_PACKAGES } from "./npm";
import { extractZip } from "./zip";

// Installs pinned language servers into $PASEO_HOME/plugin-data/editor-plus/servers/<id>/<version>/,
// the folder other Paseo plugins use for their own data (Paseo never touches plugin-data/).
// Installs only start from the user's confirmation in the app; nothing here runs on its own.

export function dataRoot(): string {
  const home = process.env.PASEO_HOME?.trim() || join(homedir(), ".paseo");
  return join(home, "plugin-data", "editor-plus");
}

const serversRoot = () => join(dataRoot(), "servers");
const recordPath = () => join(serversRoot(), "installed.json");

export function currentPlatform(): Platform | null {
  const os =
    process.platform === "win32" || process.platform === "darwin" || process.platform === "linux"
      ? process.platform
      : null;
  const arch = process.arch === "x64" || process.arch === "arm64" ? process.arch : null;
  return os && arch ? (`${os}-${arch}` as Platform) : null;
}

/** Every server the plugin can install, release ones from the generated catalog. */
export function catalog(): ServerPackage[] {
  const releases: ServerPackage[] = Object.entries(RELEASES).map(([id, release]) => ({
    id,
    name: RELEASE_INFO[id]?.name ?? id,
    version: release.version,
    homepage: RELEASE_INFO[id]?.homepage ?? `https://github.com/${release.repo}`,
    license: RELEASE_INFO[id]?.license ?? "unknown",
    install: { kind: "release", repo: release.repo },
  }));
  return [...releases, ...PACKAGES];
}

export function packageById(id: string): ServerPackage | null {
  return catalog().find((entry) => entry.id === id) ?? null;
}

export interface InstallPlan {
  packageId: string;
  name: string;
  version: string;
  license: string;
  homepage: string;
  /** What is downloaded: a URL, npm packages, or a Go module. */
  source: string;
  /** Download size in bytes when known. */
  size: number | null;
  destination: string;
  /** A tool the install needs on the daemon host, such as npm or go. */
  needs: "npm" | "go" | null;
}

export type PlanResult = { ok: true; plan: InstallPlan } | { ok: false; reason: string };

export function planInstall(packageId: string): PlanResult {
  const entry = packageById(packageId);
  if (!entry) return { ok: false, reason: `Editor Plus cannot install ${packageId}.` };
  const destination = join(serversRoot(), entry.id, entry.version);
  const base = {
    packageId: entry.id,
    name: entry.name,
    version: entry.version,
    license: entry.license,
    homepage: entry.homepage,
    destination,
  };
  switch (entry.install.kind) {
    case "release": {
      const platform = currentPlatform();
      const asset = platform ? RELEASES[entry.id]?.platforms[platform] : undefined;
      if (!asset) {
        return {
          ok: false,
          reason: `${entry.name} publishes no build for this host (${platform ?? `${process.platform}-${process.arch}`}).`,
        };
      }
      return { ok: true, plan: { ...base, source: asset.url, size: asset.size, needs: null } };
    }
    case "npm":
      return {
        ok: true,
        plan: { ...base, source: `npm: ${entry.install.packages}`, size: null, needs: "npm" },
      };
    case "go":
      return {
        ok: true,
        plan: {
          ...base,
          source: `go install ${entry.install.module}@v${entry.version}`,
          size: null,
          needs: "go",
        },
      };
  }
}

export type InstallPhase = "downloading" | "extracting" | "installing" | "done" | "failed";

export interface InstallJob {
  packageId: string;
  phase: InstallPhase;
  received: number;
  total: number | null;
  error: string | null;
}

interface Installed {
  version: string;
  installedAt: string;
  source: string;
  sha256: string | null;
}

async function readRecord(): Promise<Record<string, Installed>> {
  try {
    return JSON.parse(await readFile(recordPath(), "utf8")) as Record<string, Installed>;
  } catch {
    return {};
  }
}

async function writeRecord(record: Record<string, Installed>): Promise<void> {
  await mkdir(serversRoot(), { recursive: true });
  const temporary = `${recordPath()}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
  await rename(temporary, recordPath());
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { ...options, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (error, _stdout, stderr) => {
        if (!error) resolve();
        else
          reject(
            new Error(
              `${basename(command)} failed: ${String(stderr).trim().split("\n").slice(-6).join("\n") || error.message}`,
            ),
          );
      },
    );
  });
}

/**
 * Installs exactly the locked packages into `folder` with `npm ci`, running no install scripts.
 * `omitOptional` leaves out optional packages, such as native builds a package can do without.
 */
export async function npmCi(
  folder: string,
  files: { manifest: string; lock: string },
  npm: string,
  options: { omitOptional: boolean },
): Promise<void> {
  await writeFile(join(folder, "package.json"), files.manifest);
  await writeFile(join(folder, "package-lock.json"), files.lock);
  // npm is a Node.js script; make sure the node next to it is found.
  const path = `${dirname(npm)}${delimiter}${process.env.PATH ?? ""}`;
  const omit = options.omitOptional ? ["--omit=optional"] : [];
  await run(npm, ["ci", "--omit=dev", ...omit, "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: folder,
    env: { ...process.env, PATH: path },
    timeout: 600_000,
  });
}

/** Finds a file named `name` (or `name.exe`) under `root`, a few levels deep. */
export async function findFile(root: string, name: string, depth = 4): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isFile() && (entry.name === name || entry.name === `${name}.exe`)) {
      return join(root, entry.name);
    }
  }
  if (depth === 0) return null;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "node_modules") continue;
    const found = await findFile(join(root, entry.name), name, depth - 1);
    if (found) return found;
  }
  return null;
}

/**
 * npm servers run on the Node.js that runs this plugin, so they need no `node` on PATH. In the
 * desktop app that is Electron, which acts as Node.js with ELECTRON_RUN_AS_NODE.
 */
function nodeLaunch(script: string): Launch {
  return {
    command: process.execPath,
    args: [script],
    env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : undefined,
  };
}

/** The script an npm package installs as `binary`, from its package.json `bin`. */
async function npmBinScript(folder: string, binary: string): Promise<string | null> {
  const modules = join(folder, "node_modules");
  let names: string[];
  try {
    names = await readdir(modules);
  } catch {
    return null;
  }
  const packages = (
    await Promise.all(
      names.map(async (name) =>
        name.startsWith("@")
          ? (await readdir(join(modules, name)).catch(() => [])).map((inner) => `${name}/${inner}`)
          : [name],
      ),
    )
  ).flat();
  for (const name of packages) {
    try {
      const manifest = JSON.parse(await readFile(join(modules, name, "package.json"), "utf8")) as {
        bin?: string | Record<string, string>;
      };
      const bin =
        typeof manifest.bin === "string" ? { [name]: manifest.bin } : (manifest.bin ?? {});
      if (bin[binary]) return join(modules, name, bin[binary]);
    } catch {
      // Not a package.
    }
  }
  return null;
}

export class Installer {
  private readonly jobs = new Map<string, InstallJob>();

  job(packageId: string): InstallJob | null {
    return this.jobs.get(packageId) ?? null;
  }

  async installed(packageId: string): Promise<{ version: string; folder: string } | null> {
    const record = (await readRecord())[packageId];
    if (!record) return null;
    const folder = join(serversRoot(), packageId, record.version);
    try {
      await stat(folder);
    } catch {
      return null;
    }
    return { version: record.version, folder };
  }

  /** How to run `binary` from an installed package, if it is installed. */
  async launch(
    packageId: string,
    binary: string,
  ): Promise<{ launch: Launch; version: string; path: string } | null> {
    const installed = await this.installed(packageId);
    const entry = packageById(packageId);
    if (!installed || !entry) return null;
    if (entry.install.kind === "npm") {
      const script = await npmBinScript(installed.folder, binary);
      return script
        ? { launch: nodeLaunch(script), version: installed.version, path: script }
        : null;
    }
    const path = await findFile(installed.folder, binary);
    return path ? { launch: { command: path, args: [] }, version: installed.version, path } : null;
  }

  /** Starts an install in the background; poll `job` for progress. */
  start(packageId: string, tools: { npm: string | null; go: string | null }): InstallJob {
    const running = this.jobs.get(packageId);
    if (running && running.phase !== "done" && running.phase !== "failed") return running;
    const job: InstallJob = {
      packageId,
      phase: "downloading",
      received: 0,
      total: null,
      error: null,
    };
    this.jobs.set(packageId, job);
    void this.install(job, tools).then(
      () => {
        job.phase = "done";
      },
      (error: unknown) => {
        job.phase = "failed";
        job.error = error instanceof Error ? error.message : String(error);
      },
    );
    return job;
  }

  async remove(packageId: string): Promise<void> {
    await rm(join(serversRoot(), packageId), { recursive: true, force: true });
    const record = await readRecord();
    delete record[packageId];
    await writeRecord(record);
    this.jobs.delete(packageId);
  }

  private async install(job: InstallJob, tools: { npm: string | null; go: string | null }) {
    const planned = planInstall(job.packageId);
    if (!planned.ok) throw new Error(planned.reason);
    const { plan } = planned;
    const entry = packageById(job.packageId) as ServerPackage;
    const staging = join(serversRoot(), ".staging", randomUUID());
    await mkdir(staging, { recursive: true });
    try {
      let sha256: string | null = null;
      switch (entry.install.kind) {
        case "release":
          sha256 = await this.installRelease(job, plan, staging);
          break;
        case "npm":
          await this.installNpm(job, staging, tools.npm);
          break;
        case "go":
          await this.installGo(job, entry, staging, tools.go);
          break;
      }
      // Replace any earlier version in one step.
      await rm(join(serversRoot(), entry.id), { recursive: true, force: true });
      await mkdir(dirname(plan.destination), { recursive: true });
      await rename(staging, plan.destination);
      const record = await readRecord();
      record[entry.id] = {
        version: entry.version,
        installedAt: new Date().toISOString(),
        source: plan.source,
        sha256,
      };
      await writeRecord(record);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  private async installRelease(
    job: InstallJob,
    plan: InstallPlan,
    staging: string,
  ): Promise<string> {
    const platform = currentPlatform() as Platform;
    const asset = RELEASES[job.packageId].platforms[platform]!;
    job.total = asset.size;
    const response = await fetch(asset.url, { redirect: "follow" });
    if (!response.ok || !response.body)
      throw new Error(`Download failed: HTTP ${response.status}.`);
    const name = basename(new URL(asset.url).pathname);
    const download = join(staging, `.download-${name}`);
    const hash = createHash("sha256");
    const out = createWriteStream(download);
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      job.received += chunk.length;
      if (!out.write(chunk))
        await new Promise<void>((resolve) => out.once("drain", () => resolve()));
    }
    await new Promise<void>((resolve, reject) =>
      out.end((error?: Error | null) => (error ? reject(error) : resolve())),
    );
    const digest = hash.digest("hex");
    if (digest !== asset.sha256) {
      throw new Error(`The download's checksum does not match the pinned one (got ${digest}).`);
    }
    job.phase = "extracting";
    const binary = plan.name;
    if (name.endsWith(".tar.gz") || name.endsWith(".tgz")) {
      await run("tar", ["-xzf", download, "-C", staging], { timeout: 300_000 });
    } else if (name.endsWith(".zip")) {
      await extractZip(await readFile(download), staging);
    } else if (name.endsWith(".gz")) {
      await pipeline(
        Readable.from(await readFile(download)),
        createGunzip(),
        createWriteStream(join(staging, binary)),
      );
    } else {
      await rename(download, join(staging, name.endsWith(".exe") ? `${binary}.exe` : binary));
    }
    await rm(download, { force: true });
    const executable = await findFile(staging, binary);
    if (!executable) throw new Error(`The release contains no ${binary} executable.`);
    await chmod(executable, 0o755);
    return digest;
  }

  private async installNpm(job: InstallJob, staging: string, npm: string | null): Promise<void> {
    if (!npm) throw new Error("Installing this server needs npm on the daemon host.");
    const files = NPM_PACKAGES[job.packageId];
    if (!files) throw new Error(`No pinned npm packages for ${job.packageId}.`);
    job.phase = "installing";
    await npmCi(staging, files, npm, { omitOptional: false });
  }

  private async installGo(
    job: InstallJob,
    entry: ServerPackage,
    staging: string,
    go: string | null,
  ): Promise<void> {
    if (!go || entry.install.kind !== "go")
      throw new Error("Installing gopls needs Go on the daemon host.");
    job.phase = "installing";
    await run(go, ["install", `${entry.install.module}@v${entry.version}`], {
      cwd: staging,
      env: { ...process.env, GOBIN: join(staging, "bin") },
      timeout: 900_000,
    });
  }
}
