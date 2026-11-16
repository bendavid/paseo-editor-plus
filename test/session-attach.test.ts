import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EditorSession } from "../server/session";
import { SessionSink } from "./session-sink";

// `cat` echoes each framed message back, which makes it a language server that answers everything
// with what it was sent.
function echoSession(): EditorSession {
  return new EditorSession({
    id: "echo",
    command: "cat",
    args: [],
    name: "cat",
    root: mkdtempSync(join(tmpdir(), "editor-plus-session-")),
    preview: null,
  });
}

async function collect(sink: SessionSink, count: number): Promise<string[]> {
  const seen: string[] = [];
  for (let attempt = 0; attempt < 50 && seen.length < count; attempt += 1) {
    seen.push(...(await sink.take(200)).lsp);
  }
  return seen;
}

describe.runIf(process.platform !== "win32")("EditorSession subscriptions", () => {
  it("keeps output while no subscription is attached and hands it to the next one", async () => {
    const session = echoSession();
    session.sendLsp(['{"n":1}', '{"n":2}'], 1);
    // The same batch again, as when a call is retried after a reconnect: passed on once.
    session.sendLsp(['{"n":1}', '{"n":2}'], 1);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(session.detachedSince).not.toBeNull();

    const first = new SessionSink(session);
    expect(session.detachedSince).toBeNull();
    expect(await collect(first, 2)).toEqual(['{"n":1}', '{"n":2}']);

    // A reconnecting app subscribes again before the old subscription has gone.
    const second = new SessionSink(session);
    await first.done;
    session.sendLsp(['{"n":3}'], 2);
    expect(await collect(second, 1)).toEqual(['{"n":3}']);
    expect((await first.take(0)).lsp).toEqual([]);

    second.detach();
    await second.done;
    expect(session.detachedSince).not.toBeNull();
    session.sendLsp(['{"n":4}'], 3);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const third = new SessionSink(session);
    expect(await collect(third, 1)).toEqual(['{"n":4}']);

    session.close();
    await third.done;
    const last = await third.take(0);
    expect(last.alive).toBe(false);
    expect(last.exit).toBe("The session was closed.");
  });

  it("ends the subscription with the reason when the server exits", async () => {
    const session = new EditorSession({
      id: "exit",
      command: "sh",
      args: ["-c", "echo 'ERROR broken' >&2; exit 3"],
      name: "broken",
      root: tmpdir(),
      preview: null,
    });
    const sink = new SessionSink(session);
    await sink.done;
    const taken = await sink.take(0);
    expect(taken.alive).toBe(false);
    expect(taken.exit).toContain("broken exited with code 3.");
    expect(taken.exit).toContain("ERROR broken");
  });
});
