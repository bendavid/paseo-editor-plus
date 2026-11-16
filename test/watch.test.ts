import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type FileState, watchFile } from "../server/watch";

function states() {
  const seen: FileState[] = [];
  let wake: (() => void) | null = null;
  return {
    seen,
    changed(state: FileState) {
      seen.push(state);
      wake?.();
    },
    /** Waits until `count` states have been reported. */
    async until(count: number) {
      const deadline = Date.now() + 5000;
      while (seen.length < count && Date.now() < deadline) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 100);
        });
      }
      return seen;
    },
  };
}

describe("watchFile", () => {
  it("reports the file now and each time a build replaces or removes it", async () => {
    const folder = mkdtempSync(join(tmpdir(), "editor-plus-watch-"));
    const pdf = join(folder, "main.pdf");
    const controller = new AbortController();
    const watched = states();
    watchFile(pdf, (state) => watched.changed(state), controller.signal);

    expect((await watched.until(1))[0]).toEqual({ exists: false, mtimeMs: 0, size: 0 });

    // latexmk writes a new file and renames it over the old one.
    writeFileSync(join(folder, "main.pdf.tmp"), "%PDF-1.5 one");
    renameSync(join(folder, "main.pdf.tmp"), pdf);
    const [, created] = await watched.until(2);
    expect(created).toMatchObject({ exists: true, size: 12 });

    // Unrelated files in the folder do not count.
    writeFileSync(join(folder, "main.aux"), "aux");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(watched.seen).toHaveLength(2);

    rmSync(pdf);
    const [, , removed] = await watched.until(3);
    expect(removed.exists).toBe(false);

    controller.abort();
    writeFileSync(pdf, "%PDF-1.5 two");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(watched.seen).toHaveLength(3);
  });
});
