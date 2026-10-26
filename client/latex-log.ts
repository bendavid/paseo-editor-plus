import type { LspDiagnostic } from "./lsp-transport";

// A LaTeX build log's errors as diagnostics for the open file, shown with texlab's (which covers
// only some of them). TeX gives no line for errors such as a file ending inside an argument; those
// go on the last use of the command the message names, or the first line.

export interface LogError {
  file: string;
  /** One-based, or null. */
  line: number | null;
  message: string;
}

/** Errors in `filePath`, as LSP diagnostics against `text`, its current contents. */
export function buildDiagnostics(
  errors: readonly LogError[],
  filePath: string,
  text: string,
): LspDiagnostic[] {
  const lines = text.split("\n");
  const diagnostics: LspDiagnostic[] = [];
  for (const error of errors) {
    if (!samePath(error.file, filePath)) continue;
    let index = error.line === null ? guessLine(error.message, lines) : error.line - 1;
    index = Math.min(Math.max(index, 0), lines.length - 1);
    diagnostics.push({
      range: {
        start: { line: index, character: 0 },
        end: { line: index, character: lines[index].length },
      },
      severity: 1,
      source: "LaTeX build",
      message: error.message,
    });
  }
  return diagnostics;
}

/** The line of the last use of the command an error names ("use of \textbf"), or the first. */
function guessLine(message: string, lines: readonly string[]): number {
  const command = /use of (\\[A-Za-z@]+)/.exec(message)?.[1];
  if (command) {
    const pattern = new RegExp(`${command.replace(/\\/g, "\\\\")}(?![A-Za-z@])`);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (pattern.test(lines[index])) return index;
    }
  }
  return 0;
}

function samePath(a: string, b: string): boolean {
  const normal = (path: string) => path.replace(/\\/g, "/").replace(/\/\.\//g, "/");
  return normal(a) === normal(b);
}
