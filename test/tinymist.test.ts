import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { findTinymist, parseVersion, TinymistNotFoundError } from "../server/tinymist";

function hasTinymist(): boolean {
  try {
    execFileSync("tinymist", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("tinymist discovery", () => {
  it("reads release versions and tolerates builds without one", () => {
    expect(parseVersion("tinymist 0.15.10\nBuild Timestamp: ...")).toBe("0.15.10");
    expect(parseVersion("tinymist v0.14.0-rc1")).toBe("0.14.0-rc1");
    expect(parseVersion("tinymist \nBuild Git Describe: VERGEN_IDEMPOTENT_OUTPUT")).toBeNull();
  });

  it("rejects a configured path that is relative or not executable", async () => {
    await expect(findTinymist("bin/tinymist")).rejects.toBeInstanceOf(TinymistNotFoundError);
    await expect(findTinymist("/nonexistent/tinymist")).rejects.toThrow("not an executable");
  });

  it("uses a configured executable as given", async () => {
    const found = await findTinymist(process.execPath);
    expect(found).toMatchObject({ path: process.execPath, source: "setting" });
  });

  it.runIf(hasTinymist())("finds tinymist on PATH", async () => {
    expect((await findTinymist("")).source).toBe("path");
  });
});
