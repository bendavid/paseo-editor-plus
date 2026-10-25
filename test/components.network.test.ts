import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Components } from "../server/components";
import { PdfjsAssets } from "../server/pdfjs-assets";
import { Spelling } from "../server/spelling";
import type { ComponentId } from "../shared/components";

// Downloads the real components from npm; run with EDITOR_PLUS_NETWORK_TESTS=1.
const enabled = process.env.EDITOR_PLUS_NETWORK_TESTS === "1";

async function install(id: ComponentId): Promise<Components> {
  process.env.PASEO_HOME = mkdtempSync(join(tmpdir(), "editor-plus-home-"));
  const npm = execFileSync("which", ["npm"], { encoding: "utf8" }).trim();
  const components = new Components(async () => npm);
  let status = await components.ensure(id);
  while (status.state === "installing") {
    await new Promise((resolve) => setTimeout(resolve, 250));
    status = await components.status(id);
  }
  expect(status.error).toBeNull();
  expect(status.state).toBe("ready");
  return components;
}

describe.skipIf(!enabled)("components from npm", () => {
  it("installs PDF.js without its optional native canvas, and serves it", async () => {
    const components = await install("pdfjs");
    const folder = await components.readyFolder("pdfjs");
    expect(existsSync(join(folder, "node_modules", "@napi-rs"))).toBe(false);
    const assets = new PdfjsAssets(() => components.readyFolder("pdfjs"));
    expect((await assets.part("pdf")).version).toBe("6.4.299");
  }, 600_000);

  it("installs cspell, which checks spelling from plugin-data", async () => {
    const components = await install("spelling");
    const spelling = new Spelling(
      () => components.readyFolder("spelling"),
      join(process.env.PASEO_HOME!, "words.txt"),
    );
    const issues = await spelling.check("/tmp/doc.md", ["singless", "important"]);
    expect(issues.map((issue) => issue.index)).toEqual([0]);
  }, 600_000);
});
