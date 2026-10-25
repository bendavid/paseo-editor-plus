import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  latexRoot,
  parseSynctexRecords,
  pdfFor,
  synctexForward,
  synctexInverse,
} from "../server/latex";

function has(command: string): boolean {
  try {
    execFileSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("LaTeX preview support", () => {
  it("finds the root document from a magic comment", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tex-"));
    writeFileSync(join(dir, "chapter.tex"), "% !TEX root = main.tex\n\\section{A}\n");
    writeFileSync(join(dir, "main.tex"), "\\documentclass{article}\n");
    expect(await latexRoot(join(dir, "chapter.tex"))).toBe(join(dir, "main.tex"));
    expect(await latexRoot(join(dir, "main.tex"))).toBe(join(dir, "main.tex"));
    expect(pdfFor(join(dir, "main.tex"))).toBe(join(dir, "main.pdf"));
  });

  it("parses synctex view and edit output", () => {
    const view = parseSynctexRecords(
      "SyncTeX result begin\nOutput:/t/main.pdf\nPage:1\nx:159.5\ny:156.6\nh:133.7\nv:158.5\nW:343.7\nH:8.8\nSyncTeX result end\n",
    );
    expect(view).toEqual([
      {
        Output: "/t/main.pdf",
        Page: "1",
        x: "159.5",
        y: "156.6",
        h: "133.7",
        v: "158.5",
        W: "343.7",
        H: "8.8",
      },
    ]);
    const edit = parseSynctexRecords(
      "Output:/t/main.pdf\nInput:/t/./main.tex\nLine:3\nColumn:-1\n",
    );
    expect(edit.at(-1)).toMatchObject({ Input: "/t/./main.tex", Line: "3" });
  });

  it.runIf(has("latexmk") && has("synctex"))(
    "maps a source line to the PDF and back with a real build",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "tex-"));
      const main = join(dir, "main.tex");
      writeFileSync(
        main,
        "\\documentclass{article}\n\\begin{document}\n\\section{Intro}\nHello world, this is a test.\n\nSecond paragraph here.\n\\end{document}\n",
      );
      execFileSync("latexmk", ["-pdf", "-interaction=nonstopmode", "-synctex=1", "main.tex"], {
        cwd: dir,
        stdio: "ignore",
      });
      const boxes = await synctexForward("synctex", pdfFor(main), main, 4, 0);
      expect(boxes.length).toBeGreaterThan(0);
      const box = boxes[0];
      expect(box.page).toBe(1);
      const back = await synctexInverse(
        "synctex",
        pdfFor(main),
        box.page,
        box.x + 5,
        box.y + box.height / 2,
      );
      expect(back?.file).toBe(main);
      expect(back?.line).toBe(4);
    },
    60_000,
  );
});
