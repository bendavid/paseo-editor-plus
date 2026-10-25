import { describe, expect, it } from "vitest";
import { frameLspMessage, LspMessageReader } from "../server/framing";

describe("LSP framing", () => {
  it("round-trips messages, including several in one chunk", () => {
    const reader = new LspMessageReader();
    const chunk = Buffer.concat([frameLspMessage('{"a":1}'), frameLspMessage('{"b":"ü"}')]);
    expect(reader.push(chunk)).toEqual(['{"a":1}', '{"b":"ü"}']);
  });

  it("waits for the rest of a message split across chunks, even inside a character", () => {
    const reader = new LspMessageReader();
    const framed = frameLspMessage('{"text":"日本語"}');
    const cut = framed.length - 4; // inside the last multi-byte character
    expect(reader.push(framed.subarray(0, 10))).toEqual([]);
    expect(reader.push(framed.subarray(10, cut))).toEqual([]);
    expect(reader.push(framed.subarray(cut))).toEqual(['{"text":"日本語"}']);
  });

  it("counts Content-Length in bytes and ignores other headers", () => {
    const reader = new LspMessageReader();
    const body = Buffer.from('{"x":"é"}');
    const message = Buffer.concat([
      Buffer.from(
        `Content-Type: application/vscode-jsonrpc; charset=utf-8\r\nContent-Length: ${body.length}\r\n\r\n`,
      ),
      body,
    ]);
    expect(reader.push(message)).toEqual(['{"x":"é"}']);
  });
});
