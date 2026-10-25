import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

// One editor tab is one session: a language server process on the daemon host, its preview, and
// the queues that carry their messages to the app. Plugin calls cannot push, so the app holds a
// poll open and the server answers it as soon as anything arrives.

export const serverSettings = defineSettings({
  id: "servers",
  scope: "host",
  version: 1,
  schema: z.object({
    /** Per language id: the server's absolute path, empty to find it on the daemon host. */
    servers: z.record(z.string(), z.object({ path: z.string().default("") })).default({}),
  }),
});

const languageId = z.string().min(1).max(50);

const sessionId = z.string().min(1).max(100);

export const openSession = defineRpc({
  name: "editorplus.session.open",
  input: z.object({
    language: languageId,
    /** Absolute path of the open file on the daemon host. */
    file: z.string().min(1).max(4096),
    /** The workspace directory, the project root unless the file is outside it. */
    root: z.string().min(1).max(4096),
  }),
  output: z.discriminatedUnion("ok", [
    z.object({
      ok: z.literal(true),
      sessionId,
      rootUri: z.string(),
      fileUri: z.string(),
      version: z.string().nullable(),
    }),
    z.object({
      ok: z.literal(false),
      /** "missing": no language server binary; "failed": it did not start. */
      reason: z.enum(["missing", "failed"]),
      message: z.string(),
    }),
  ]),
});

/** Messages for the language server, in order. Each is one JSON-RPC message without LSP headers. */
export const sendLsp = defineRpc({
  name: "editorplus.session.send",
  input: z.object({ sessionId, messages: z.array(z.string().max(16_000_000)).max(1000) }),
  output: z.object({ alive: z.boolean() }),
});

export const previewFrame = z.object({
  /** "text" and "binary" are WebSocket messages; "close" means the connection ended. */
  t: z.enum(["text", "binary", "close"]),
  /** The text, or the bytes in base64. */
  d: z.string(),
});
export type PreviewFrame = z.infer<typeof previewFrame>;

export const pollSession = defineRpc({
  name: "editorplus.session.poll",
  input: z.object({ sessionId, waitMs: z.number().int().min(0).max(25_000) }),
  output: z.object({
    alive: z.boolean(),
    /** Why the language server stopped, with the end of its log, once it has. */
    exit: z.string().nullable(),
    lsp: z.array(z.string()),
    preview: z.array(previewFrame),
  }),
});

export const connectPreview = defineRpc({
  name: "editorplus.preview.connect",
  input: z.object({
    sessionId,
    /** A port the session's preview reported, on 127.0.0.1 on the daemon host. */
    port: z.number().int().min(1).max(65535),
    /** The preview page can be large (tinymist's is 2 MB); the app asks for it once per preview. */
    includeHtml: z.boolean(),
  }),
  output: z.object({ html: z.string().nullable() }),
});

export const sendPreview = defineRpc({
  name: "editorplus.preview.send",
  input: z.object({ sessionId, messages: z.array(z.string().max(1_000_000)).max(1000) }),
  output: z.object({ alive: z.boolean() }),
});

export const closeSession = defineRpc({
  name: "editorplus.session.close",
  input: z.object({ sessionId }),
  output: z.object({}),
});

export const serverStatus = defineRpc({
  name: "editorplus.server.status",
  input: z.object({ language: languageId }),
  output: z.object({
    path: z.string().nullable(),
    version: z.string().nullable(),
    /** Where the binary was found. */
    source: z.enum(["setting", "path", "shell", "common"]).nullable(),
    error: z.string().nullable(),
  }),
});
