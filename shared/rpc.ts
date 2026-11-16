import { defineRpc, defineSettings, defineSubscription } from "@getpaseo/plugin";
import { z } from "zod";

// One editor tab is one session: a language server process on the daemon host and its preview.
// The app sends to them with calls, and their output comes back on the session's subscription.

/** Paseo's own editor saves this long after the last edit. */
export const AUTO_SAVE_DEFAULT_MS = 800;
export const AUTO_SAVE_MIN_MS = 100;
export const AUTO_SAVE_MAX_MS = 60_000;

export const serverSettings = defineSettings({
  id: "servers",
  scope: "host",
  version: 1,
  schema: z.object({
    /** Save each file shortly after the last edit; when off, Mod-S saves. */
    autoSave: z.boolean().default(true),
    autoSaveDelayMs: z
      .number()
      .int()
      .min(AUTO_SAVE_MIN_MS)
      .max(AUTO_SAVE_MAX_MS)
      .default(AUTO_SAVE_DEFAULT_MS),
    /** Per language id: the server's absolute path, empty to find it on the daemon host. */
    servers: z
      .record(
        z.string(),
        z.object({
          path: z.string().default(""),
          /** For languages that build a PDF (Typst, LaTeX): build it whenever the file is saved. */
          compileOnSave: z.boolean().default(false),
        }),
      )
      .default({}),
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

/**
 * Numbers a session's batches from 1, separately for the language server and the preview. The app
 * sends a batch again when a call fails during a reconnect; the session skips a number it has
 * already passed on, in case the first call got through.
 */
const batchSeq = z.number().int().min(1);

/** Messages for the language server, in order. Each is one JSON-RPC message without LSP headers. */
export const sendLsp = defineRpc({
  name: "editorplus.session.send",
  input: z.object({
    sessionId,
    seq: batchSeq,
    messages: z.array(z.string().max(16_000_000)).max(1000),
  }),
  output: z.object({ alive: z.boolean() }),
});

/**
 * What a session sends the app, in order: the language server's messages, the preview's WebSocket
 * messages (binary ones as raw bytes), and finally why the session ended.
 */
export const sessionEvents = defineSubscription({
  name: "editorplus.session.events",
  input: z.object({ sessionId }),
  event: z.union([
    z.instanceof(Uint8Array),
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("lsp"), messages: z.array(z.string()) }),
      z.object({ type: z.literal("preview"), text: z.string() }),
      /** The preview's WebSocket closed. */
      z.object({ type: z.literal("previewClosed") }),
      /** The language server stopped; the subscription closes after this. */
      z.object({ type: z.literal("ended"), reason: z.string() }),
    ]),
  ]),
});
export type SessionEvent = z.input<typeof sessionEvents.event>;

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
  input: z.object({
    sessionId,
    seq: batchSeq,
    messages: z.array(z.string().max(1_000_000)).max(1000),
  }),
  output: z.object({ alive: z.boolean() }),
});

export const closeSession = defineRpc({
  name: "editorplus.session.close",
  input: z.object({ sessionId }),
  output: z.object({}),
});

const installPhase = z.enum(["downloading", "extracting", "installing", "done", "failed"]);

const serverStatusSchema = z.object({
  path: z.string().nullable(),
  version: z.string().nullable(),
  /** Where the server in use was found. */
  source: z.enum(["setting", "installed", "path", "shell", "common"]).nullable(),
  error: z.string().nullable(),
  /** What installing would download, when the plugin can install this server here. */
  install: z
    .object({
      name: z.string(),
      version: z.string(),
      license: z.string(),
      homepage: z.string(),
      source: z.string(),
      size: z.number().nullable(),
      destination: z.string(),
      needs: z.enum(["npm", "go"]).nullable(),
    })
    .nullable(),
  /** Why the plugin cannot install it here, when it cannot. */
  installUnavailable: z.string().nullable(),
  /** The copy the plugin installed, if any. */
  installed: z.object({ version: z.string(), folder: z.string() }).nullable(),
  /** The latest install of this server since the daemon started. */
  job: z
    .object({
      phase: installPhase,
      received: z.number(),
      total: z.number().nullable(),
      error: z.string().nullable(),
    })
    .nullable(),
});

/** The language's server on the daemon host, again whenever it or its install changes. */
export const serverStatus = defineSubscription({
  name: "editorplus.server.status",
  input: z.object({ language: languageId }),
  event: serverStatusSchema,
});

/** Starts installing the language's server; `serverStatus` follows its progress. */
export const installServer = defineRpc({
  name: "editorplus.server.install",
  input: z.object({ language: languageId }),
  output: z.object({ started: z.boolean(), error: z.string().nullable() }),
});

/** Deletes the copy of the language's server that the plugin installed. */
export const removeServer = defineRpc({
  name: "editorplus.server.remove",
  input: z.object({ language: languageId }),
  output: z.object({}),
});

// --- Previews rendered or built on the daemon host.

/** Markdown rendered to HTML on the daemon host: plain Markdown, or a Marp slide deck. */
export const renderMarkdown = defineRpc({
  name: "editorplus.render.markdown",
  input: z.object({ file: z.string().min(1).max(4096), text: z.string().max(8_000_000) }),
  output: z.object({ kind: z.enum(["markdown", "marp"]), html: z.string(), css: z.string() }),
});

/** The PDF a LaTeX file builds: its own, or its root document's (`% !TEX root = ...`). */
export const locatePdf = defineRpc({
  name: "editorplus.pdf.locate",
  input: z.object({ file: z.string().min(1).max(4096) }),
  output: z.object({ root: z.string(), pdf: z.string() }),
});

const pdfPath = z
  .string()
  .min(5)
  .max(4096)
  .regex(/\.pdf$/i);

/** The PDF's state now, and again whenever the build rewrites it. */
export const pdfChanges = defineSubscription({
  name: "editorplus.pdf.changes",
  input: z.object({ path: pdfPath }),
  event: z.object({ exists: z.boolean(), mtimeMs: z.number(), size: z.number() }),
});

/** Bytes of PDF per read. */
export const PDF_CHUNK = 8 * 1024 * 1024;

/** Up to `PDF_CHUNK` bytes of a built PDF from `offset`; fewer at its end. */
export const readPdf = defineRpc({
  name: "editorplus.pdf.read",
  input: z.object({ path: pdfPath, offset: z.number().int().min(0) }),
  output: z.instanceof(Uint8Array),
});

const syncBox = z.object({
  page: z.number(),
  /** The box in PDF points from the page's top-left corner. */
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

/** SyncTeX: where a source line is in the PDF. */
export const synctexForward = defineRpc({
  name: "editorplus.synctex.forward",
  input: z.object({
    pdf: pdfPath,
    file: z.string().min(1).max(4096),
    line: z.number().int().min(1),
    column: z.number().int().min(0),
  }),
  output: z.object({ boxes: z.array(syncBox), error: z.string().nullable() }),
});

/** SyncTeX: which source line produced a point in the PDF (points from the page's top-left). */
export const synctexInverse = defineRpc({
  name: "editorplus.synctex.inverse",
  input: z.object({ pdf: pdfPath, page: z.number().int().min(1), x: z.number(), y: z.number() }),
  output: z.object({
    file: z.string().nullable(),
    line: z.number().nullable(),
    column: z.number().nullable(),
    error: z.string().nullable(),
  }),
});

export const RUNTIME_PARTS = ["pdf", "viewer", "worker", "css"] as const;
export type RuntimePart = (typeof RUNTIME_PARTS)[number];

/** One source file of the PDF.js runtime, which the app loads on web only. */
export const pdfjsPart = defineRpc({
  name: "editorplus.pdfjs.part",
  input: z.object({ part: z.enum(RUNTIME_PARTS) }),
  output: z.object({ version: z.string(), source: z.string() }),
});

/** Kinds match the `kind` PDF.js passes to its BinaryDataFactory. */
export const BINARY_KINDS = ["cMapUrl", "standardFontDataUrl", "wasmUrl"] as const;
export type BinaryKind = (typeof BINARY_KINDS)[number];

/** The file's bytes, or null when PDF.js has no such file. */
export const pdfjsBinary = defineRpc({
  name: "editorplus.pdfjs.binary",
  input: z.object({ kind: z.enum(BINARY_KINDS), filename: z.string().min(1).max(200) }),
  output: z.union([z.instanceof(Uint8Array), z.null()]),
});

// --- Components downloaded on first use (shared/components.ts).

const componentId = z.enum(["pdfjs", "spelling"]);
const componentStatus = z.object({
  id: componentId,
  state: z.enum(["ready", "missing", "installing", "failed"]),
  version: z.string(),
  folder: z.string().nullable(),
  destination: z.string(),
  error: z.string().nullable(),
});

/** A component's status; with `install` (only after the user confirms), downloads it if missing. */
export const componentStatusRpc = defineRpc({
  name: "editorplus.component.status",
  input: z.object({ id: componentId, install: z.boolean(), retry: z.boolean().optional() }),
  output: componentStatus,
});

/** A component's status now, and again whenever it changes (an install starts, ends, or fails). */
export const componentChanges = defineSubscription({
  name: "editorplus.component.changes",
  input: z.object({ id: componentId }),
  event: componentStatus,
});

export const removeComponent = defineRpc({
  name: "editorplus.component.remove",
  input: z.object({ id: componentId }),
  output: z.object({}),
});

// --- Spelling.

const filePath = z.string().min(1).max(4096);
/** A word as the editor splits prose: letters, digits, apostrophes, and underscores. */
const word = z.string().min(1).max(100);

/** The misspelled parts of words from `file`; `state` is the spelling component's. */
export const checkSpelling = defineRpc({
  name: "editorplus.spell.check",
  input: z.object({ file: filePath, words: z.array(word).max(2000) }),
  output: z.object({
    state: componentStatus.shape.state,
    error: z.string().nullable(),
    issues: z.array(
      z.object({ index: z.number().int(), offset: z.number().int(), length: z.number().int() }),
    ),
  }),
});

export const suggestSpelling = defineRpc({
  name: "editorplus.spell.suggest",
  input: z.object({ file: filePath, word }),
  output: z.object({ suggestions: z.array(z.string()), error: z.string().nullable() }),
});

/** Adds a word to the personal dictionary in plugin-data. */
export const addSpellingWord = defineRpc({
  name: "editorplus.spell.add",
  input: z.object({ word }),
  output: z.object({ error: z.string().nullable() }),
});

/**
 * The errors in the build log of a LaTeX file's root document, now and whenever the log changes:
 * texlab reports only some of them.
 */
export const latexLogChanges = defineSubscription({
  name: "editorplus.latex.log",
  input: z.object({ file: z.string().min(1).max(4096) }),
  event: z.object({
    errors: z.array(
      z.object({ file: z.string(), line: z.number().int().nullable(), message: z.string() }),
    ),
  }),
});
