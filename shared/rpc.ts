import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

// One editor tab is one session: a `tinymist lsp` process on the daemon host, its preview server,
// and the queues that carry their messages to the app. Plugin calls cannot push, so the app holds
// a poll open and the server answers it as soon as anything arrives.

export const tinymistSettings = defineSettings({
  id: "tinymist",
  scope: "host",
  version: 1,
  schema: z.object({
    /** Absolute path to the tinymist binary; empty to find it on the daemon host. */
    tinymistPath: z.string().default(""),
  }),
});

const sessionId = z.string().min(1).max(100);

export const openSession = defineRpc({
  name: "typst.session.open",
  input: z.object({
    /** Absolute path of the open file on the daemon host. */
    file: z.string().min(1).max(4096),
    /** The workspace directory, the Typst project root unless the file is outside it. */
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
      /** "missing": no tinymist binary; "failed": it did not start. */
      reason: z.enum(["missing", "failed"]),
      message: z.string(),
    }),
  ]),
});

/** Messages for tinymist, in order. Each is one JSON-RPC message without LSP headers. */
export const sendLsp = defineRpc({
  name: "typst.session.send",
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
  name: "typst.session.poll",
  input: z.object({ sessionId, waitMs: z.number().int().min(0).max(25_000) }),
  output: z.object({
    alive: z.boolean(),
    /** Why tinymist stopped, with the end of its log, once it has. */
    exit: z.string().nullable(),
    lsp: z.array(z.string()),
    preview: z.array(previewFrame),
  }),
});

export const connectPreview = defineRpc({
  name: "typst.preview.connect",
  input: z.object({
    sessionId,
    /** A data plane port tinymist reported for this session. */
    port: z.number().int().min(1).max(65535),
    /** The preview page is about 2 MB; the app asks for it once per panel. */
    includeHtml: z.boolean(),
  }),
  output: z.object({ html: z.string().nullable() }),
});

export const sendPreview = defineRpc({
  name: "typst.preview.send",
  input: z.object({ sessionId, messages: z.array(z.string().max(1_000_000)).max(1000) }),
  output: z.object({ alive: z.boolean() }),
});

export const closeSession = defineRpc({
  name: "typst.session.close",
  input: z.object({ sessionId }),
  output: z.object({}),
});

export const tinymistStatus = defineRpc({
  name: "typst.tinymist.status",
  input: z.object({}),
  output: z.object({
    path: z.string().nullable(),
    version: z.string().nullable(),
    /** Where the binary was found. */
    source: z.enum(["setting", "path", "shell", "common"]).nullable(),
    error: z.string().nullable(),
  }),
});
