import { describe, expect, it } from "vitest";
import { LspTransport } from "../client/lsp-transport";
import { tinymistPreview } from "../client/previews/tinymist";

function setup() {
  const sent: unknown[] = [];
  const received: string[] = [];
  const notifications: string[] = [];
  let refreshes = 0;
  const transport = new LspTransport(
    (message) => sent.push(JSON.parse(message)),
    {
      notification: (method) => {
        notifications.push(method);
        return method.startsWith("tinymist/");
      },
      refreshSemanticTokens: () => (refreshes += 1),
    },
    { formatterMode: "typstyle" },
    "tinymist",
  );
  transport.subscribe((message) => received.push(message));
  return { transport, sent, received, notifications, refreshes: () => refreshes };
}

describe("LspTransport", () => {
  it("answers workspace/configuration with the server's settings", () => {
    const { transport, sent, received } = setup();
    transport.receive(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "workspace/configuration",
        params: { items: [{ section: "tinymist" }, { section: "other" }] },
      }),
    );
    expect(sent).toEqual([
      { jsonrpc: "2.0", id: 7, result: [{ formatterMode: "typstyle" }, null] },
    ]);
    expect(received).toEqual([]);
  });

  it("acknowledges progress, capability registration, and token refreshes", () => {
    const { transport, sent, refreshes } = setup();
    transport.receive(
      JSON.stringify({ jsonrpc: "2.0", id: "p", method: "window/workDoneProgress/create" }),
    );
    transport.receive(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "client/registerCapability" }),
    );
    transport.receive(
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "workspace/semanticTokens/refresh" }),
    );
    expect(sent).toEqual([
      { jsonrpc: "2.0", id: "p", result: null },
      { jsonrpc: "2.0", id: 2, result: null },
      { jsonrpc: "2.0", id: 3, result: null },
    ]);
    expect(refreshes()).toBe(1);
  });

  it("offers notifications to the panel first", () => {
    const { transport, received, notifications } = setup();
    transport.receive(
      JSON.stringify({ jsonrpc: "2.0", method: "tinymist/documentOutline", params: {} }),
    );
    const diagnostics = JSON.stringify({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {},
    });
    transport.receive(diagnostics);
    expect(notifications).toEqual(["tinymist/documentOutline", "textDocument/publishDiagnostics"]);
    expect(received).toEqual([diagnostics]);
  });

  it("passes responses and unknown requests to the language client", () => {
    const { transport, received, sent } = setup();
    const messages = [
      { jsonrpc: "2.0", id: 1, result: {} },
      { jsonrpc: "2.0", id: 3, method: "window/showDocument", params: {} },
    ].map((message) => JSON.stringify(message));
    for (const message of messages) transport.receive(message);
    expect(received).toEqual(messages);
    expect(sent).toEqual([]);
  });
});

describe("tinymist preview provider", () => {
  it("reads jumps from the preview in character columns", () => {
    const jump = tinymistPreview.sourceJump("tinymist/preview/scrollSource", {
      filepath: "/w/main.typ",
      start: [3, 1],
      end: [3, 5],
    });
    expect(jump).toEqual({
      path: "/w/main.typ",
      start: { line: 3, character: 1 },
      end: { line: 3, character: 5 },
    });
    expect(tinymistPreview.sourceJump("textDocument/publishDiagnostics", {})).toBeNull();
  });

  it("starts the preview through the language server and reports its port", async () => {
    const calls: [string, unknown[]][] = [];
    const context = {
      filePath: "/w/main.typ",
      command: async (name: string, args: unknown[]) => {
        calls.push([name, args]);
        return { dataPlanePort: 4321 };
      },
    };
    const { port, task } = await tinymistPreview.start(context);
    expect(port).toBe(4321);
    expect(calls[0][0]).toBe("tinymist.doStartPreview");
    expect(calls[0][1]).toEqual([expect.arrayContaining(["--task-id", task, "/w/main.typ"])]);
  });
});
