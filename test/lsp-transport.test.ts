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

  it("starts the preview through the language server and connects to its port", async () => {
    const requests: [string, unknown][] = [];
    const connects: unknown[] = [];
    const views: string[] = [];
    const services = {
      filePath: "/w/main.typ",
      text: () => "",
      client: {
        initializing: Promise.resolve(),
        request: async (method: string, params: unknown) => {
          requests.push([method, params]);
          return { dataPlanePort: 4321 };
        },
        notify() {},
        disconnect() {},
      },
      session: { id: "s1", sendPreview() {} },
      calls: {
        connectPreview: async (input: unknown) => {
          connects.push(input);
          return { html: "<html><head></head></html>" };
        },
      },
      web: {
        mountPreview: (_parent: unknown, html: string) => {
          views.push(html);
          return { deliver() {}, setInvert() {}, setBackground() {}, destroy() {} };
        },
      },
      parent: null,
      theme: { colors: { surface1: "#fff" } },
      invert: false,
      jump() {},
      openExternal() {},
      notice() {},
    } as unknown as Parameters<typeof tinymistPreview.start>[0];
    const preview = await tinymistPreview.start(services);
    const [method, params] = requests[0] as [string, { command: string; arguments: string[][] }];
    expect(method).toBe("workspace/executeCommand");
    expect(params.command).toBe("tinymist.doStartPreview");
    expect(params.arguments[0]).toEqual(expect.arrayContaining(["--task-id", "/w/main.typ"]));
    expect(connects).toEqual([{ sessionId: "s1", port: 4321, includeHtml: true }]);
    expect(views).toHaveLength(1);
    preview.destroy();
    expect((requests.at(-1)![1] as { command: string }).command).toBe("tinymist.doKillPreview");
  });
});

describe("LspTransport diagnostics", () => {
  const diagnostic = (line: number, message: string, source = "texlab") => ({
    range: { start: { line, character: 0 }, end: { line, character: 5 } },
    severity: 1,
    source,
    message,
  });
  const published = (received: string[]) =>
    received
      .map(
        (message) =>
          JSON.parse(message) as {
            method?: string;
            params: { uri: string; diagnostics: { message: string }[] };
          },
      )
      .filter((message) => message.method === "textDocument/publishDiagnostics")
      .map((message) => message.params.diagnostics.map((d) => d.message));

  it("adds the panel's diagnostics to the server's, without repeating the server's", () => {
    const { transport, received } = setup();
    const uri = "file:///tmp/paper%20one.tex";
    transport.receive(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "textDocument/publishDiagnostics",
        params: { uri, version: 3, diagnostics: [diagnostic(4, "Undefined control sequence.")] },
      }),
    );
    transport.setExtraDiagnostics("file:///tmp/paper one.tex", [
      diagnostic(4, "Undefined control sequence", "LaTeX build"),
      diagnostic(0, "Missing \\begin{document}.", "LaTeX build"),
    ]);
    expect(published(received).at(-1)).toEqual([
      "Undefined control sequence.",
      "Missing \\begin{document}.",
    ]);
    const last = JSON.parse(received.at(-1)!) as { params: { uri: string; version: number } };
    expect(last.params.uri).toBe(uri);
    expect(last.params.version).toBe(3);

    // The server's next publication keeps the panel's diagnostics.
    transport.receive(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "textDocument/publishDiagnostics",
        params: { uri, diagnostics: [] },
      }),
    );
    expect(published(received).at(-1)).toEqual([
      "Undefined control sequence",
      "Missing \\begin{document}.",
    ]);

    // Clearing them leaves the server's.
    transport.setExtraDiagnostics(uri, []);
    expect(published(received).at(-1)).toEqual([]);
  });
});
