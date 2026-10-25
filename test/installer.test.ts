import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractZip } from "../server/zip";

function python(script: string, ...args: string[]) {
  execFileSync("python3", ["-I", "-c", script, ...args]);
}

describe("zip extraction", () => {
  it("extracts stored and deflated entries and keeps executable bits", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-test-"));
    const archive = join(dir, "a.zip");
    python(
      `import sys, zipfile
z = zipfile.ZipFile(sys.argv[1], "w")
info = zipfile.ZipInfo("tool_1.0/bin/tool")
info.external_attr = 0o755 << 16
info.compress_type = zipfile.ZIP_DEFLATED
z.writestr(info, b"#!/bin/sh\\necho hi\\n" * 100)
z.writestr("tool_1.0/README", b"plain", compress_type=zipfile.ZIP_STORED)
z.close()`,
      archive,
    );
    const out = join(dir, "out");
    expect(await extractZip(readFileSync(archive), out)).toBe(2);
    expect(readFileSync(join(out, "tool_1.0/README"), "utf8")).toBe("plain");
    expect(statSync(join(out, "tool_1.0/bin/tool")).mode & 0o111).not.toBe(0);
  });

  it("refuses entries that escape the folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-test-"));
    const archive = join(dir, "evil.zip");
    python(
      `import sys, zipfile
z = zipfile.ZipFile(sys.argv[1], "w")
z.writestr("../escape", b"x")
z.close()`,
      archive,
    );
    await expect(extractZip(readFileSync(archive), join(dir, "out"))).rejects.toThrow(
      "Unsafe path",
    );
  });
});
