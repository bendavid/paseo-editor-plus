import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { EditorSession } from "../server/session";

function tinymistPath(): string | null {
  try {
    execFileSync("tinymist", ["--version"], { stdio: "ignore" });
    return "tinymist";
  } catch {
    return null;
  }
}

async function until<T>(session: EditorSession, find: (messages: string[]) => T | undefined) {
  const seen: string[] = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await session.poll(2000);
    seen.push(...result.lsp);
    const found = find(seen);
    if (found !== undefined) return found;
  }
  throw new Error(`Not found in: ${seen.join("\n").slice(0, 2000)}`);
}

describe.runIf(tinymistPath())("EditorSession with the installed tinymist", () => {
  it("runs the language server and its preview, and stops it on close", async () => {
    const root = mkdtempSync(join(tmpdir(), "typst-session-"));
    const file = join(root, "main.typ");
    writeFileSync(file, "= Hello\n#lorem(10)\n");
    const session = new EditorSession({
      id: "t",
      command: tinymistPath()!,
      args: ["lsp"],
      name: "tinymist",
      root,
      preview: "tinymist",
    });
    const rpc = (id: number, method: string, params: unknown) =>
      JSON.stringify({ jsonrpc: "2.0", id, method, params });
    session.sendLsp([
      rpc(1, "initialize", {
        processId: null,
        rootUri: pathToFileURL(root).href,
        capabilities: {},
      }),
    ]);
    const init = await until(session, (seen) => seen.find((m) => m.includes('"id":1')));
    expect(JSON.parse(init).result.capabilities.completionProvider).toBeTruthy();
    session.sendLsp([
      JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }),
      JSON.stringify({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri: pathToFileURL(file).href,
            languageId: "typst",
            version: 1,
            text: "= Hello\n",
          },
        },
      }),
      rpc(2, "workspace/executeCommand", {
        command: "tinymist.doStartPreview",
        arguments: [["--task-id", "t1", "--data-plane-host", "127.0.0.1:0", "--no-open", file]],
      }),
    ]);
    const started = await until(session, (seen) => seen.find((m) => m.includes('"id":2')));
    const port = JSON.parse(started).result.dataPlanePort as number;
    await expect(session.connectPreview(port + 1, false)).rejects.toThrow(
      "did not start a preview",
    );
    const html = await session.connectPreview(port, true);
    expect(html).toContain("typst-app");
    session.sendPreview(["current"]);
    let frames = 0;
    for (let attempt = 0; attempt < 10 && frames === 0; attempt += 1) {
      frames += (await session.poll(2000)).preview.filter((frame) => frame.t === "binary").length;
    }
    expect(frames).toBeGreaterThan(0);
    session.close();
    const after = await session.poll(0);
    expect(after.alive).toBe(false);
  }, 60_000);
});
