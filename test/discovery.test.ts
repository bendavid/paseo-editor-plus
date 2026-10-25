import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { findServer, parseVersion, ServerNotFoundError } from "../server/discovery";

const tinymist = (configured: string) =>
  findServer({ binary: "tinymist", configured, homepage: "https://example.org" });

function hasTinymist(): boolean {
  try {
    execFileSync("tinymist", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("language server discovery", () => {
  it("reads the server's own version, not other tools' in the same output", () => {
    expect(parseVersion("tinymist", "tinymist 0.15.10\nBuild Timestamp: ...")).toBe("0.15.10");
    expect(parseVersion("tinymist", "tinymist v0.14.0-rc1")).toBe("0.14.0-rc1");
    expect(parseVersion("tinymist", "tinymist \nTypst Version: 0.15.1")).toBeNull();
    expect(parseVersion("rust-analyzer", "rust-analyzer 1.84.0 (9fc6b43 2025-01-07)")).toBe(
      "1.84.0",
    );
  });

  it("rejects a configured path that is relative or not executable", async () => {
    await expect(tinymist("bin/tinymist")).rejects.toBeInstanceOf(ServerNotFoundError);
    await expect(tinymist("/nonexistent/tinymist")).rejects.toThrow("not an executable");
  });

  it("uses a configured executable as given", async () => {
    const found = await tinymist(process.execPath);
    expect(found).toMatchObject({ path: process.execPath, source: "setting" });
  });

  it("reports a missing server with its homepage", async () => {
    await expect(
      findServer({ binary: "no-such-server-xyz", configured: "", homepage: "https://example.org" }),
    ).rejects.toThrow(
      "no-such-server-xyz was not found on the daemon host. Install it (see https://example.org)",
    );
  });

  it.runIf(hasTinymist())("finds tinymist on PATH", async () => {
    expect((await tinymist("")).source).toBe("path");
  });
});
