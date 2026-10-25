import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A stand-in for a downloaded component: a folder whose node_modules is this repository's, where
 * pdfjs-dist and cspell-lib are dev dependencies.
 */
export async function fakeComponent(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "editor-plus-component-"));
  await symlink(join(__dirname, "..", "node_modules"), join(folder, "node_modules"), "dir");
  return folder;
}
