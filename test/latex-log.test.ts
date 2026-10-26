import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDiagnostics } from "../client/latex-log";
import { logFor, parseLatexLog } from "../server/latex";

function has(command: string): boolean {
  try {
    execFileSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Builds `main.tex` (and other files) with latexmk as texlab does, and parses the log. */
function build(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "texlog-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const root = join(dir, "main.tex");
  try {
    execFileSync("latexmk", ["-pdf", "-interaction=nonstopmode", "-synctex=1", "main.tex"], {
      cwd: dir,
      stdio: "ignore",
      timeout: 60_000,
    });
  } catch {
    // The builds here fail on purpose.
  }
  return { dir, root, errors: parseLatexLog(readFileSync(logFor(root), "utf8"), root) };
}

describe.skipIf(!has("latexmk"))("LaTeX build log", () => {
  it("finds errors in a file without \\documentclass, which texlab ignores", () => {
    const { root, errors } = build({ "main.tex": "test eae\n\nff\n" });
    expect(errors).toContainEqual({ file: root, line: 3, message: "Missing \\begin{document}." });
    expect(errors.some((error) => error.message.startsWith("Emergency stop"))).toBe(false);
  }, 60_000);

  it("keeps errors without a line, and places them on the command they name", () => {
    const text =
      "\\documentclass{article}\n\\begin{document}\nUnclosed \\textbf{bold\n\\end{document}\n";
    const { root, errors } = build({ "main.tex": text });
    const error = errors.find((found) => found.message.includes("scanning use of \\textbf"));
    expect(error).toMatchObject({ file: root, line: null });
    const [diagnostic] = buildDiagnostics([error!], root, text);
    expect(diagnostic.range.start.line).toBe(2);
    expect(diagnostic.source).toBe("LaTeX build");
  }, 60_000);

  it("attributes an error to the included file it is in", () => {
    const { dir, errors } = build({
      "main.tex":
        "\\documentclass{article}\n\\begin{document}\nIntro.\n\\input{chapter}\n\\end{document}\n",
      "chapter.tex": "First line.\nA \\nosuchcommand here.\n",
    });
    expect(errors).toContainEqual({
      file: join(dir, "chapter.tex"),
      line: 2,
      message: "Undefined control sequence.",
    });
    expect(
      buildDiagnostics(errors, join(dir, "main.tex"), "").some((d) => d.message.includes("nosuch")),
    ).toBe(false);
  }, 60_000);
});
