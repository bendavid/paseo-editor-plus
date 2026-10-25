import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { SEMANTIC_TOKENS_CAPABILITY } from "../client/web/semantic-tokens";
import { LANGUAGES, languageIdFor } from "../shared/languages";

// Installs every language's server into a temporary PASEO_HOME, runs it the way the plugin
// does, and checks it answers a real editor session. Run with EDITOR_PLUS_NETWORK_TESTS=1;
// it downloads several hundred megabytes and needs npm and Go.
const enabled = process.env.EDITOR_PLUS_NETWORK_TESTS === "1";

const SAMPLES: Record<string, [string, string][]> = {
  typst: [["main.typ", "= Title\n#let f(x) = x + 1\n#f(2)\n"]],
  python: [
    ["main.py", "def greet(name: str) -> str:\n    return name.upper()\n\nprint(greet('x'))\n"],
  ],
  rust: [
    ["Cargo.toml", '[package]\nname = "sample"\nversion = "0.1.0"\nedition = "2021"\n'],
    ["src/main.rs", 'fn main() {\n    let x = 1;\n    println!("{x}");\n}\n'],
  ],
  go: [
    ["go.mod", "module sample\n\ngo 1.22\n"],
    ["main.go", 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hi")\n}\n'],
  ],
  cpp: [
    [
      "main.cpp",
      "#include <vector>\nint main() {\n  std::vector<int> v{1, 2};\n  return v.size();\n}\n",
    ],
  ],
  javascript: [
    ["index.ts", "export function add(a: number, b: number): number {\n  return a + b;\n}\n"],
  ],
  latex: [
    [
      "main.tex",
      "\\documentclass{article}\n\\begin{document}\n\\section{Intro}\\label{sec:intro}\nSee \\ref{sec:intro}.\n\\end{document}\n",
    ],
  ],
  markdown: [["README.md", "# Title\n\n## Section\n\nSee [the section](#section).\n"]],
  json: [["data.json", '{\n  "a": 1,\n  "b": [true, null]\n}\n']],
  css: [["style.css", "body {\n  color: red;\n}\n"]],
  html: [["index.html", "<!doctype html>\n<html><body><p>Hi</p></body></html>\n"]],
};

describe.runIf(enabled)("every language's server", () => {
  let installer: import("../server/installer").Installer;
  const tools = {
    npm: execFileSync("sh", ["-c", "command -v npm"], { encoding: "utf8" }).trim(),
    go: execFileSync("sh", ["-c", "command -v go || true"], { encoding: "utf8" }).trim() || null,
  };

  beforeAll(async () => {
    process.env.PASEO_HOME = mkdtempSync(join(tmpdir(), "editor-plus-servers-"));
    const { Installer } = await import("../server/installer");
    installer = new Installer();
    const packages = [...new Set(LANGUAGES.map((language) => language.server.package))];
    const jobs = packages.map((id) => installer.start(id, tools));
    while (jobs.some((job) => job.phase !== "done" && job.phase !== "failed")) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    for (const job of jobs) expect(job.error, job.packageId).toBeNull();
  }, 1_200_000);

  for (const language of LANGUAGES) {
    it(`${language.title}: ${language.server.name} answers an editor session`, async () => {
      const { EditorSession } = await import("../server/session");
      const launch = await installer.launch(language.server.package, language.server.binary);
      expect(launch, "installed launch").not.toBeNull();
      const root = mkdtempSync(join(tmpdir(), `editor-plus-${language.id}-`));
      for (const [name, text] of SAMPLES[language.id]) {
        mkdirSync(join(root, name, ".."), { recursive: true });
        writeFileSync(join(root, name), text);
      }
      const [fileName, text] = SAMPLES[language.id].at(-1)!;
      const file = join(root, fileName);
      const session = new EditorSession({
        id: language.id,
        command: launch!.launch.command,
        args: [...launch!.launch.args, ...language.server.args],
        env: launch!.launch.env,
        name: language.server.name,
        root,
        preview: language.preview,
      });
      const seen: string[] = [];
      const answer = async (id: number) => {
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const { lsp, alive, exit } = await session.poll(1000);
          seen.push(...lsp);
          for (const message of lsp) {
            const parsed = JSON.parse(message) as { id?: number; method?: string };
            // Answer the server's own requests, as the panel's transport does.
            if (parsed.method && parsed.id !== undefined) {
              session.sendLsp([
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: parsed.id,
                  result: parsed.method === "workspace/configuration" ? [] : null,
                }),
              ]);
            }
          }
          const found = seen
            .map((m) => JSON.parse(m))
            .find((m) => m.id === id && m.method === undefined);
          if (found) return found;
          if (!alive) throw new Error(exit ?? "server exited");
        }
        throw new Error(`no answer to ${id}`);
      };
      const uri = pathToFileURL(file).href;
      session.sendLsp([
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            processId: null,
            rootUri: pathToFileURL(root).href,
            initializationOptions: language.server.options,
            capabilities: {
              ...SEMANTIC_TOKENS_CAPABILITY,
              textDocument: {
                ...SEMANTIC_TOKENS_CAPABILITY.textDocument,
                documentSymbol: { hierarchicalDocumentSymbolSupport: true },
                hover: { contentFormat: ["markdown"] },
              },
            },
          },
        }),
      ]);
      const init = await answer(1);
      expect(init.error, JSON.stringify(init.error)).toBeUndefined();
      const capabilities = init.result.capabilities;
      session.sendLsp([
        JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }),
        JSON.stringify({
          jsonrpc: "2.0",
          method: "textDocument/didOpen",
          params: {
            textDocument: {
              uri,
              languageId: languageIdFor(language, fileName.split(".").pop()!),
              version: 1,
              text,
            },
          },
        }),
      ]);
      let checked = "initialize";
      if (capabilities.semanticTokensProvider?.full) {
        session.sendLsp([
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "textDocument/semanticTokens/full",
            params: { textDocument: { uri } },
          }),
        ]);
        const tokens = await answer(2);
        expect(tokens.error, JSON.stringify(tokens.error)).toBeUndefined();
        checked = `semantic tokens (${(tokens.result?.data?.length ?? 0) / 5})`;
      } else if (capabilities.documentSymbolProvider) {
        session.sendLsp([
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "textDocument/documentSymbol",
            params: { textDocument: { uri } },
          }),
        ]);
        const symbols = await answer(2);
        expect(symbols.error, JSON.stringify(symbols.error)).toBeUndefined();
        checked = `document symbols (${symbols.result?.length ?? 0})`;
      }
      console.log(`${language.title}: ${language.server.name} ${launch!.version} — ${checked}`);
      session.close();
    }, 180_000);
  }
});
