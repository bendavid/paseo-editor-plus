import type { EditorExcerpt } from "./web-contract";

// What "Send to agent" puts in an agent's message box: where in the file, the code, and the
// problems the editor shows there. The user then types the question after it.

/** Lines of code sent at most; the agent can read the rest of the file itself. */
const MAX_LINES = 400;

/** The file as the agent sees it: relative to the workspace when inside it. */
export function displayPath(path: string, workspace: string | null): string {
  if (!workspace) return path;
  const root = workspace.replace(/[\\/]+$/, "");
  if (path.startsWith(`${root}/`) || path.startsWith(`${root}\\`)) {
    return path.slice(root.length + 1);
  }
  return path;
}

/** A Markdown code fence longer than any run of backticks in `code`. */
function fenceFor(code: string): string {
  let longest = 0;
  for (const run of code.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return "`".repeat(Math.max(3, longest + 1));
}

function trimmed(code: string): string {
  const lines = code.replace(/\n$/, "").split("\n");
  if (lines.length <= MAX_LINES) return lines.join("\n");
  const rest = lines.length - MAX_LINES;
  return `${lines.slice(0, MAX_LINES).join("\n")}\n… (${rest} more line${rest === 1 ? "" : "s"})`;
}

/**
 * The text to insert. Code goes in when something is selected (the selection) or the lines have
 * problems (the lines); otherwise only the reference does.
 */
export function agentMessage(input: {
  path: string;
  /** The code fence's language, such as the file's extension. */
  language: string;
  excerpt: EditorExcerpt;
  /** What the message box holds already. */
  prompt: string;
}): string {
  const { excerpt } = input;
  const lines =
    excerpt.startLine === excerpt.endLine
      ? `${excerpt.startLine}`
      : `${excerpt.startLine}-${excerpt.endLine}`;
  const parts = [`\`${input.path}:${lines}\``];
  const code =
    excerpt.selection.trim() !== ""
      ? excerpt.selection
      : excerpt.problems.length > 0
        ? excerpt.lines
        : "";
  if (code !== "") {
    const body = trimmed(code);
    const fence = fenceFor(body);
    parts.push(`${fence}${input.language}\n${body}\n${fence}`);
  }
  if (excerpt.problems.length > 0) {
    const problems = excerpt.problems.map((problem) => {
      const source = problem.source ? `, ${problem.source}` : "";
      return `- ${problem.severity} on line ${problem.line}${source}: ${problem.message.trim()}`;
    });
    parts.push(`Problems:\n${problems.join("\n")}`);
  }
  const separator = input.prompt === "" || /\n\s*$/.test(input.prompt) ? "" : "\n\n";
  return `${separator}${parts.join("\n")}\n\n`;
}
