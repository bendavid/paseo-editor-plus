import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { COMPONENTS, type ComponentId, type ComponentStatus } from "../shared/components";
import { dataRoot, npmCi } from "./installer";
import { NPM_COMPONENTS } from "./npm";

// Downloads components (shared/components.ts) into plugin-data the first time something needs
// them. They are the plugin's own code and data, pinned by lockfile, so they install without asking;
// the settings list them and remove them.

/** After a failed install, how long callers wait before an automatic retry. */
const RETRY_AFTER_MS = 30_000;

const componentsRoot = () => join(dataRoot(), "components");

export function componentFolder(id: ComponentId): string {
  return join(componentsRoot(), id, COMPONENTS[id].version);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

interface Job {
  promise: Promise<void>;
  error: string | null;
  failedAt: number;
}

export class Components {
  private readonly jobs = new Map<ComponentId, Job>();

  constructor(private readonly findNpm: () => Promise<string | null>) {}

  async status(id: ComponentId): Promise<ComponentStatus> {
    const folder = componentFolder(id);
    const base = { id, version: COMPONENTS[id].version };
    // The folder appears only once its install has finished (it is renamed from staging).
    if (await exists(folder)) return { ...base, state: "ready", folder, error: null };
    const job = this.jobs.get(id);
    if (!job) return { ...base, state: "missing", folder: null, error: null };
    if (job.error !== null) return { ...base, state: "failed", folder: null, error: job.error };
    return { ...base, state: "installing", folder: null, error: null };
  }

  /**
   * The component's status, starting its install if it is missing. A failed install is retried
   * when `retry` is set, or once a little time has passed.
   */
  async ensure(id: ComponentId, retry = false): Promise<ComponentStatus> {
    const current = await this.status(id);
    if (current.state === "ready" || current.state === "installing") return current;
    const job = this.jobs.get(id);
    if (job && !retry && Date.now() - job.failedAt < RETRY_AFTER_MS) return current;
    this.start(id);
    return this.status(id);
  }

  /** The installed folder; throws when the component is not installed (yet). */
  async readyFolder(id: ComponentId): Promise<string> {
    const status = await this.status(id);
    if (status.state === "ready" && status.folder) return status.folder;
    throw new Error(`${COMPONENTS[id].name} is not installed yet.`);
  }

  async remove(id: ComponentId): Promise<void> {
    await this.jobs.get(id)?.promise;
    await rm(join(componentsRoot(), id), { recursive: true, force: true });
    this.jobs.delete(id);
  }

  private start(id: ComponentId): void {
    const job: Job = { promise: Promise.resolve(), error: null, failedAt: 0 };
    job.promise = this.install(id).then(
      () => {
        this.jobs.delete(id);
      },
      (error: unknown) => {
        job.error = error instanceof Error ? error.message : String(error);
        job.failedAt = Date.now();
      },
    );
    this.jobs.set(id, job);
  }

  private async install(id: ComponentId): Promise<void> {
    const npm = await this.findNpm();
    if (!npm) throw new Error("Downloading it needs npm on the daemon host.");
    const staging = join(componentsRoot(), ".staging", randomUUID());
    await mkdir(staging, { recursive: true });
    try {
      // Optional packages are native builds (PDF.js's canvas for Node) the app never uses.
      await npmCi(staging, NPM_COMPONENTS[id], npm, { omitOptional: true });
      const folder = componentFolder(id);
      // Other versions belong to earlier releases of the plugin.
      for (const name of await readdir(join(componentsRoot(), id)).catch(() => [])) {
        if (name !== COMPONENTS[id].version) {
          await rm(join(componentsRoot(), id, name), { recursive: true, force: true });
        }
      }
      await mkdir(join(componentsRoot(), id), { recursive: true });
      await rename(staging, folder);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}
