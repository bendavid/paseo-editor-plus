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

export interface LogError {
  /** The source file, absolute. */
  file: string;
  /** One-based, or null when TeX gave none (a fatal error at the end of the input). */
  line: number | null;
  message: string;
}

/** TeX wraps log lines at this many characters; a full line continues on the next. */
const LOG_WIDTH = 79;
/** How far after an error TeX prints its `l.<n>` context. */
const CONTEXT_LINES = 12;
/** Consequences of an earlier error, not errors of their own. */
const SKIPPED = [/^Emergency stop/, /^==> Fatal error occurred/];

/**
 * The errors in a LaTeX log (`! …` lines) and where they are. TeX prints `(path` when it opens a
 * file and `)` when it closes it, so a stack of those names the file an error is in; `l.<n>` after
 * the error gives its line. texlab reports some of these itself, but not errors without a line
 * (such as a file ending inside an argument) nor any for a file without `\documentclass`.
 */
export function parseLatexLog(text: string, root: string): LogError[] {
  // Rejoin lines TeX wrapped, so paths and messages are whole.
  const raw = text.split(/\r?\n/);
  const lines: string[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    let line = raw[index];
    while (line.length > 0 && line.length % LOG_WIDTH === 0 && index + 1 < raw.length) {
      index += 1;
      line += raw[index];
    }
    lines.push(line);
  }
  const directory = dirname(root);
  const stack: (string | null)[] = [];
  const errors: LogError[] = [];
  const seen = new Set<string>();
  const currentFile = () => {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const entry = stack[index];
      if (entry && /\.(tex|ltx)$/i.test(entry)) return entry;
    }
    return root;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("! ")) {
      const message = line
        .slice(2)
        .replace(/^LaTeX Error: /, "")
        .trim();
      if (SKIPPED.some((pattern) => pattern.test(message))) continue;
      let number: number | null = null;
      for (let next = index + 1; next < Math.min(lines.length, index + CONTEXT_LINES); next += 1) {
        if (lines[next].startsWith("! ")) break;
        const match = /^l\.(\d+)/.exec(lines[next]);
        if (match) {
          number = Number(match[1]);
          break;
        }
      }
      const file = currentFile();
      const key = `${file}:${number}:${message}`;
      if (!seen.has(key)) {
        seen.add(key);
        errors.push({ file, line: number, message });
      }
      continue;
    }
    // Track the files TeX opens and closes on this line.
    const tokens =
      /\((?:"([^"]+)"|((?:\.{0,2}\/|[A-Za-z]:[\\/])[^\s()]*|[^\s()/]+\.[A-Za-z]{2,4}(?=[\s()]|$)))|\(|\)/g;
    for (const match of line.matchAll(tokens)) {
      if (match[0] === ")") stack.pop();
      else {
        const path = match[1] ?? match[2];
        stack.push(path ? (isAbsolute(path) ? path : resolve(directory, path)) : null);
      }
    }
  }
  return errors;
}

/** The log latexmk writes beside the root document. */
export function logFor(root: string): string {
  return root.replace(/\.(tex|ltx)$/i, "") + ".log";
}
