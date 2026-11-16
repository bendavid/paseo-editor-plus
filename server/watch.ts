import { type FSWatcher, watch } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname } from "node:path";

// Following a file a build rewrites (a PDF, a LaTeX log). Builds replace files rather than writing
// them in place, so this watches the folder for the file's name. Folder watches miss changes on
// some file systems (network mounts, some containers), so a slow check backs them up.

export interface FileState {
  exists: boolean;
  mtimeMs: number;
  size: number;
}

/** After a change, wait this long for the build to finish writing. */
const SETTLE_MS = 150;
/** The backup check's interval. */
const RECHECK_MS = 5000;

export async function fileState(path: string): Promise<FileState> {
  try {
    const info = await stat(path);
    return { exists: info.isFile(), mtimeMs: info.mtimeMs, size: info.size };
  } catch {
    return { exists: false, mtimeMs: 0, size: 0 };
  }
}

/**
 * Calls `changed` with the file's state now and after each change, one call at a time, until
 * `signal` aborts.
 */
export function watchFile(
  path: string,
  changed: (state: FileState) => void | Promise<void>,
  signal: AbortSignal,
): void {
  let last: FileState | null = null;
  let checking = false;
  let again = false;
  let settle: ReturnType<typeof setTimeout> | undefined;

  const check = async () => {
    if (checking) {
      again = true;
      return;
    }
    checking = true;
    try {
      do {
        again = false;
        const state = await fileState(path);
        if (signal.aborted) return;
        if (
          last &&
          last.exists === state.exists &&
          last.mtimeMs === state.mtimeMs &&
          last.size === state.size
        ) {
          continue;
        }
        last = state;
        await changed(state);
      } while (again && !signal.aborted);
    } catch {
      // The next change or backup check tries again.
    } finally {
      checking = false;
    }
  };
  const soon = () => {
    if (settle !== undefined) clearTimeout(settle);
    settle = setTimeout(() => void check(), SETTLE_MS);
  };

  const name = basename(path);
  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(dirname(path), (_event, file) => {
      if (file === null || file === name) soon();
    });
    watcher.on("error", () => {
      watcher?.close();
      watcher = null;
    });
  } catch {
    // A missing folder, or no watches left: the backup check still runs.
  }
  const recheck = setInterval(() => void check(), RECHECK_MS);
  void check();

  signal.addEventListener(
    "abort",
    () => {
      watcher?.close();
      clearInterval(recheck);
      if (settle !== undefined) clearTimeout(settle);
    },
    { once: true },
  );
}
