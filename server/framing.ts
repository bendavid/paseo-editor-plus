// LSP base protocol: each JSON-RPC message is preceded by headers, of which only Content-Length
// matters, and a blank line.

const SEPARATOR = Buffer.from("\r\n\r\n");

export function frameLspMessage(message: string): Buffer {
  const body = Buffer.from(message, "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

/** Splits a byte stream from a language server into messages. */
export class LspMessageReader {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): string[] {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const messages: string[] = [];
    for (;;) {
      const end = this.buffer.indexOf(SEPARATOR);
      if (end < 0) break;
      const headers = this.buffer.subarray(0, end).toString("ascii");
      const match = /^content-length:\s*(\d+)\s*$/im.exec(headers);
      if (!match) {
        // Not a header block; drop it rather than stall the stream.
        this.buffer = this.buffer.subarray(end + SEPARATOR.length);
        continue;
      }
      const length = Number(match[1]);
      const start = end + SEPARATOR.length;
      if (this.buffer.length < start + length) break;
      messages.push(this.buffer.subarray(start, start + length).toString("utf8"));
      this.buffer = this.buffer.subarray(start + length);
    }
    return messages;
  }
}
