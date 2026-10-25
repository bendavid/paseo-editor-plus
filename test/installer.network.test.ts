import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Downloads real servers; run with EDITOR_PLUS_NETWORK_TESTS=1.
const enabled = process.env.EDITOR_PLUS_NETWORK_TESTS === "1";

async function installed(
  packageId: string,
  binary: string,
  tools: { npm: string | null; go: string | null },
) {
  process.env.PASEO_HOME = mkdtempSync(join(tmpdir(), "editor-plus-home-"));
  const { Installer, dataRoot } = await import("../server/installer");
  const installer = new Installer();
  const job = installer.start(packageId, tools);
  while (job.phase !== "done" && job.phase !== "failed")
    await new Promise((r) => setTimeout(r, 250));
  expect(job.error).toBeNull();
  expect(dataRoot()).toBe(join(process.env.PASEO_HOME, "plugin-data", "editor-plus"));
  const launch = await installer.launch(packageId, binary);
  expect(launch).not.toBeNull();
  return { installer, launch: launch!, job };
}

function output(
  launch: { command: string; args: string[]; env?: Record<string, string> },
  args: string[],
) {
  return execFileSync(launch.command, [...launch.args, ...args], {
    env: { ...process.env, ...launch.env },
    encoding: "utf8",
    timeout: 30_000,
  });
}

describe.runIf(enabled)("installing servers", () => {
  const none = { npm: null, go: null };

  it("installs a plain binary release (marksman) and verifies its checksum", async () => {
    const { launch, job } = await installed("marksman", "marksman", none);
    expect(job.received).toBe(job.total);
    expect(output(launch.launch, ["--version"])).toMatch(/\d/);
  }, 180_000);

  it("installs a .tar.gz release (texlab)", async () => {
    const { launch } = await installed("texlab", "texlab", none);
    expect(output(launch.launch, ["--version"])).toContain("texlab");
  }, 180_000);

  it("installs a .gz release (rust-analyzer)", async () => {
    const { launch } = await installed("rust-analyzer", "rust-analyzer", none);
    expect(output(launch.launch, ["--version"])).toContain("rust-analyzer");
  }, 180_000);

  it("installs a .zip release (clangd) with its resource folder", async () => {
    const { launch } = await installed("clangd", "clangd", none);
    expect(output(launch.launch, ["--version"])).toContain("clangd version 23");
  }, 600_000);

  it("installs an npm server from its lockfile and runs it on this Node.js (basedpyright)", async () => {
    const npm = execFileSync("sh", ["-c", "command -v npm"], { encoding: "utf8" }).trim();
    const { launch, installer } = await installed("basedpyright", "basedpyright-langserver", {
      npm,
      go: null,
    });
    expect(launch.launch.command).toBe(process.execPath);
    expect(launch.path).toContain("langserver.index.js");
    await installer.remove("basedpyright");
    expect(await installer.installed("basedpyright")).toBeNull();
  }, 300_000);
});
