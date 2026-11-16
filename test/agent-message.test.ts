import { describe, expect, it } from "vitest";
import { agentMessage, displayPath } from "../client/agent-message";
import type { EditorExcerpt } from "../client/web-contract";

const excerpt = (fields: Partial<EditorExcerpt>): EditorExcerpt => ({
  startLine: 3,
  endLine: 3,
  selection: "",
  lines: "\\textbf{x",
  problems: [],
  ...fields,
});

describe("agentMessage", () => {
  it("sends only the reference when nothing is selected and the line has no problems", () => {
    expect(
      agentMessage({ path: "paper.tex", language: "tex", excerpt: excerpt({}), prompt: "" }),
    ).toBe("`paper.tex:3`\n\n");
  });

  it("sends the line with its problems", () => {
    const text = agentMessage({
      path: "paper.tex",
      language: "tex",
      excerpt: excerpt({
        problems: [
          { line: 3, severity: "error", message: "Runaway argument? ", source: "LaTeX build" },
          { line: 3, severity: "warning", message: "Unused.", source: null },
        ],
      }),
      prompt: "Please fix",
    });
    expect(text).toBe(
      "\n\n`paper.tex:3`\n```tex\n\\textbf{x\n```\nProblems:\n" +
        "- error on line 3, LaTeX build: Runaway argument?\n- warning on line 3: Unused.\n\n",
    );
  });

  it("sends a selection with a fence longer than its backticks, and cuts long ones", () => {
    const code = ["```", ...Array.from({ length: 450 }, (_, index) => `line ${index}`)].join("\n");
    const text = agentMessage({
      path: "README.md",
      language: "md",
      excerpt: excerpt({ startLine: 1, endLine: 451, selection: code }),
      prompt: "",
    });
    expect(text.startsWith("`README.md:1-451`\n````md\n```\nline 0\n")).toBe(true);
    expect(text).toContain("line 398\n… (51 more lines)\n````\n\n");
  });
});

describe("displayPath", () => {
  it("is relative inside the workspace", () => {
    expect(displayPath("/home/me/project/src/a.ts", "/home/me/project/")).toBe("src/a.ts");
    expect(displayPath("/home/me/projectx/a.ts", "/home/me/project")).toBe(
      "/home/me/projectx/a.ts",
    );
    expect(displayPath("/tmp/a.ts", null)).toBe("/tmp/a.ts");
  });
});
