import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

// The LaTeX preview's side on the daemon host: which PDF a file builds, and SyncTeX lookups in
// both directions through the `synctex` tool that ships with TeX Live and MiKTeX.

/** `% !TEX root = main.tex` near the top names the document a file belongs to. */
export async function latexRoot(file: string): Promise<string> {
  let head = "";
  try {
    head = (await readFile(file, "utf8")).split("\n").slice(0, 30).join("\n");
  } catch {
    return file;
  }
  const match = /^\s*%\s*!\s*tex\s+root\s*=\s*(.+?)\s*$/im.exec(head);
  if (!match) return file;
  const root = match[1];
  return isAbsolute(root) ? root : resolve(dirname(file), root);
}

/** latexmk writes the PDF next to the root document. */
export function pdfFor(root: string): string {
  return root.replace(/\.(tex|ltx)$/i, "") + ".pdf";
}

function run(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd, timeout: 15_000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) reject(new Error(String(stderr).trim() || error.message));
        else resolve(String(stdout));
      },
    );
  });
}

/** Parses `synctex view` and `synctex edit` output: records of `Key:value` lines. */
export function parseSynctexRecords(output: string): Record<string, string>[] {
  const records: Record<string, string>[] = [];
  let current: Record<string, string> | null = null;
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Za-z]+):(.*)$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    // Each result starts with Output (view) or Input (edit).
    if (key === "Output" || key === "Input" || !current) {
      current = {};
      records.push(current);
    }
    current[key] = value.trim();
  }
  return records;
}

export interface SyncBox {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where `line` of `file` appears in the PDF: boxes in points from each page's top-left. */
export async function synctexForward(
  synctex: string,
  pdf: string,
  file: string,
  line: number,
  column: number,
): Promise<SyncBox[]> {
  const output = await run(
    synctex,
    ["view", "-i", `${line}:${column}:${file}`, "-o", pdf],
    dirname(pdf),
  );
  const boxes: SyncBox[] = [];
  for (const record of parseSynctexRecords(output)) {
    const page = Number(record.Page);
    if (!page) continue;
    // h is the box's left edge and v its baseline; the box extends H above it.
    const h = Number(record.h);
    const v = Number(record.v);
    const width = Number(record.W);
    const height = Number(record.H);
    if (Number.isFinite(h) && Number.isFinite(v) && width > 0 && height > 0) {
      boxes.push({ page, x: h, y: v - height, width, height });
    } else if (Number.isFinite(Number(record.x)) && Number.isFinite(Number(record.y))) {
      boxes.push({ page, x: Number(record.x), y: Number(record.y) - 10, width: 40, height: 12 });
    }
  }
  return boxes;
}

/** The source line that produced a point (points from the page's top-left) in the PDF. */
export async function synctexInverse(
  synctex: string,
  pdf: string,
  page: number,
  x: number,
  y: number,
): Promise<{ file: string; line: number; column: number } | null> {
  const output = await run(synctex, ["edit", "-o", `${page}:${x}:${y}:${pdf}`], dirname(pdf));
  for (const record of parseSynctexRecords(output)) {
    const line = Number(record.Line);
    if (!record.Input || !line) continue;
    const input = isAbsolute(record.Input) ? record.Input : join(dirname(pdf), record.Input);
    return { file: resolve(input), line, column: Math.max(0, Number(record.Column) || 0) };
  }
  return null;
}
