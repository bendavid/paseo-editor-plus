import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Components, componentFolder } from "../server/components";
import { COMPONENTS, type ComponentId } from "../shared/components";

let home: string;
const previousHome = process.env.PASEO_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "editor-plus-components-"));
  process.env.PASEO_HOME = home;
});

afterEach(async () => {
  if (previousHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = previousHome;
  await rm(home, { recursive: true, force: true });
});

describe("components", () => {
  it("pin the versions their lockfiles install", async () => {
    const main: Record<ComponentId, string> = { pdfjs: "pdfjs-dist", spelling: "cspell-lib" };
    for (const id of Object.keys(COMPONENTS) as ComponentId[]) {
      const manifest = JSON.parse(
        await readFile(join(__dirname, "..", "server", "npm", id, "package.json"), "utf8"),
      ) as { dependencies: Record<string, string> };
      expect(manifest.dependencies[main[id]]).toBe(COMPONENTS[id].version);
    }
  });

  it("install into plugin-data, by version", () => {
    expect(componentFolder("spelling")).toBe(
      join(
        home,
        "plugin-data",
        "editor-plus",
        "components",
        "spelling",
        COMPONENTS.spelling.version,
      ),
    );
  });

  it("report a missing component, and why it could not be downloaded", async () => {
    const components = new Components(async () => null);
    expect((await components.status("pdfjs")).state).toBe("missing");
    await expect(components.readyFolder("pdfjs")).rejects.toThrow("not installed");
    const started = await components.ensure("pdfjs");
    expect(["installing", "failed"]).toContain(started.state);
    for (let i = 0; i < 50 && (await components.status("pdfjs")).state === "installing"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const failed = await components.status("pdfjs");
    expect(failed.state).toBe("failed");
    expect(failed.error).toContain("needs npm");
    // A failure is not retried on every call, only when asked or after a while.
    expect((await components.ensure("pdfjs")).state).toBe("failed");
  });
});
