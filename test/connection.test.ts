import { describe, expect, it } from "vitest";
import {
  OrderedSender,
  SessionConnection,
  type SessionCalls,
  type SessionEventData,
} from "../client/connection";
import type { PreviewFrame } from "../client/web-contract";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("SessionConnection", () => {
  it("sends one batch at a time, in order", async () => {
    const batches: string[][] = [];
    const numbers: number[] = [];
    const gates: ReturnType<typeof deferred<{ alive: boolean }>>[] = [];
    const calls: SessionCalls = {
      send: ({ seq, messages }) => {
        batches.push(messages);
        numbers.push(seq);
        const gate = deferred<{ alive: boolean }>();
        gates.push(gate);
        return gate.promise;
      },
      sendPreview: async () => ({ alive: true }),
      close: async () => ({}),
      subscribe: () => () => {},
    };
    const connection = new SessionConnection(calls, "s", { lsp() {}, preview() {}, ended() {} });
    connection.sendLsp("1");
    connection.sendLsp("2");
    connection.sendLsp("3");
    expect(batches).toEqual([["1"]]);
    gates[0].resolve({ alive: true });
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(batches).toEqual([["1"], ["2", "3"]]);
    expect(numbers).toEqual([1, 2]);
    connection.close();
  });

  it("sends a failed batch again with the same number, then carries on", async () => {
    const calls: { seq: number; messages: string[] }[] = [];
    let failures = 2;
    const waits: number[] = [];
    const failed: unknown[] = [];
    const sender = new OrderedSender(
      async (seq, messages) => {
        calls.push({ seq, messages });
        if (failures-- > 0) throw new Error("Transport not connected");
      },
      (error) => failed.push(error),
      async (ms) => {
        waits.push(ms);
      },
    );
    sender.push("a");
    sender.push("b");
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(calls).toEqual([
      { seq: 1, messages: ["a"] },
      { seq: 1, messages: ["a"] },
      { seq: 1, messages: ["a"] },
      { seq: 2, messages: ["b"] },
    ]);
    expect(waits).toEqual([250, 500]);
    expect(failed).toEqual([]);
  });

  it("delivers the session's events in order and ends with the server", () => {
    const lsp: string[] = [];
    const frames: PreviewFrame[] = [];
    const ended: string[] = [];
    let push!: (event: SessionEventData) => void;
    let released = 0;
    const calls: SessionCalls = {
      send: async () => ({ alive: true }),
      sendPreview: async () => ({ alive: true }),
      close: async () => ({}),
      subscribe: (_sessionId, event) => {
        push = event;
        return () => {
          released += 1;
        };
      },
    };
    new SessionConnection(calls, "s", {
      lsp: (m) => lsp.push(m),
      preview: (frame) => frames.push(frame),
      ended: (reason) => ended.push(reason),
    });
    const bytes = new Uint8Array([1, 2, 3]);
    push({ type: "lsp", messages: ["a", "b"] });
    push(bytes);
    push({ type: "preview", text: "hello" });
    push({ type: "previewClosed" });
    push({ type: "lsp", messages: ["c"] });
    push({ type: "ended", reason: "tinymist exited with code 1." });
    push({ type: "lsp", messages: ["late"] });
    expect(lsp).toEqual(["a", "b", "c"]);
    expect(frames).toEqual([
      { kind: "binary", bytes },
      { kind: "text", text: "hello" },
      { kind: "closed" },
    ]);
    expect(ended).toEqual(["tinymist exited with code 1."]);
    expect(released).toBe(1);
  });

  it("reports a lost subscription once, and not after closing", () => {
    let closed!: (error?: Error) => void;
    const ended: string[] = [];
    const calls: SessionCalls = {
      send: async () => ({ alive: true }),
      sendPreview: async () => ({ alive: true }),
      close: async () => ({}),
      subscribe: (_sessionId, _event, onClosed) => {
        closed = onClosed;
        return () => {};
      },
    };
    const lost = new SessionConnection(calls, "a", {
      lsp() {},
      preview() {},
      ended: (reason) => ended.push(reason),
    });
    closed(new Error("The plugin stopped."));
    closed(new Error("again"));
    expect(ended).toEqual(["Lost the connection to the language server: The plugin stopped."]);
    expect(lost.active).toBe(false);

    const closedByTab = new SessionConnection(calls, "b", {
      lsp() {},
      preview() {},
      ended: (reason) => ended.push(reason),
    });
    closedByTab.close();
    closed();
    expect(ended).toHaveLength(1);
  });
});
