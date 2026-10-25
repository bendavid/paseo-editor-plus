import { describe, expect, it } from "vitest";
import { SessionConnection, type SessionCalls } from "../client/connection";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("SessionConnection", () => {
  it("sends one batch at a time, in order", async () => {
    const batches: string[][] = [];
    const gates: ReturnType<typeof deferred<{ alive: boolean }>>[] = [];
    const neverPoll = new Promise<never>(() => {});
    const calls: SessionCalls = {
      send: ({ messages }) => {
        batches.push(messages);
        const gate = deferred<{ alive: boolean }>();
        gates.push(gate);
        return gate.promise;
      },
      poll: () => neverPoll,
      sendPreview: async () => ({ alive: true }),
      close: async () => ({}),
    };
    const connection = new SessionConnection(calls, "s", { lsp() {}, preview() {}, ended() {} });
    connection.sendLsp("1");
    connection.sendLsp("2");
    connection.sendLsp("3");
    expect(batches).toEqual([["1"]]);
    gates[0].resolve({ alive: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(batches).toEqual([["1"], ["2", "3"]]);
    connection.close();
  });

  it("delivers polled messages and ends when the server exits", async () => {
    const lsp: string[] = [];
    const ended = deferred<string>();
    let polls = 0;
    const calls: SessionCalls = {
      send: async () => ({ alive: true }),
      poll: async () => {
        polls += 1;
        if (polls === 1) return { alive: true, exit: null, lsp: ["a", "b"], preview: [] };
        return { alive: false, exit: "tinymist exited with code 1.", lsp: ["c"], preview: [] };
      },
      sendPreview: async () => ({ alive: true }),
      close: async () => ({}),
    };
    new SessionConnection(calls, "s", {
      lsp: (m) => lsp.push(m),
      preview() {},
      ended: ended.resolve,
    });
    expect(await ended.promise).toBe("tinymist exited with code 1.");
    expect(lsp).toEqual(["a", "b", "c"]);
  });
});
