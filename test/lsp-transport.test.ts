import { describe, expect, it } from "vitest";
import { LspTransport, type SourceJump } from "../client/lsp-transport";

function setup() {
  const sent: unknown[] = [];
  const received: string[] = [];
  const jumps: SourceJump[] = [];
  const transport = new LspTransport(
    (message) => sent.push(JSON.parse(message)),
    { scrollSource: (jump) => jumps.push(jump) },
    { formatterMode: "typstyle" },
  );
  transport.subscribe((message) => received.push(message));
  return { transport, sent, received, jumps };
}

describe("LspTransport", () => {
  it("answers workspace/configuration with the tinymist settings", () => {
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

  it("acknowledges progress and capability registration", () => {
    const { transport, sent } = setup();
    transport.receive(
      JSON.stringify({ jsonrpc: "2.0", id: "p", method: "window/workDoneProgress/create" }),
    );
    transport.receive(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "client/registerCapability" }),
    );
    expect(sent).toEqual([
      { jsonrpc: "2.0", id: "p", result: null },
      { jsonrpc: "2.0", id: 2, result: null },
    ]);
  });

  it("hands preview jumps to the panel and drops other tinymist notifications", () => {
    const { transport, received, jumps } = setup();
    const jump = { filepath: "/w/main.typ", start: [3, 1], end: [3, 5] };
    transport.receive(
      JSON.stringify({ jsonrpc: "2.0", method: "tinymist/preview/scrollSource", params: jump }),
    );
    transport.receive(
      JSON.stringify({ jsonrpc: "2.0", method: "tinymist/documentOutline", params: {} }),
    );
    expect(jumps).toEqual([jump]);
    expect(received).toEqual([]);
  });

  it("passes everything else to the language client", () => {
    const { transport, received, sent } = setup();
    const messages = [
      { jsonrpc: "2.0", id: 1, result: {} },
      { jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: {} },
      { jsonrpc: "2.0", id: 3, method: "window/showDocument", params: {} },
    ].map((message) => JSON.stringify(message));
    for (const message of messages) transport.receive(message);
    expect(received).toEqual(messages);
    expect(sent).toEqual([]);
  });
});
