import { randomUUID } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { findServer, ServerNotFoundError } from "./server/discovery";
import { Components } from "./server/components";
import { dataRoot, Installer, planInstall } from "./server/installer";
import {
  latexRoot,
  pdfFor,
  synctexForward as forward,
  synctexInverse as inverse,
} from "./server/latex";
import { renderMarkdown as render } from "./server/markdown";
import { PdfjsAssets } from "./server/pdfjs-assets";
import { EditorSession } from "./server/session";
import { personalWordsFile, Spelling } from "./server/spelling";
import { type LanguageProfile, languageById } from "./shared/languages";
import {
  addSpellingWord,
  checkSpelling,
  componentStatusRpc,
  removeComponent,
  suggestSpelling,
  closeSession,
  connectPreview,
  openSession,
  pollSession,
  sendLsp,
  sendPreview,
  installServer,
  locatePdf,
  pdfjsBinary,
  pdfjsPart,
  readPdf,
  removeServer,
  renderMarkdown,
  statPdf,
  synctexForward,
  synctexInverse,
  serverSettings,
  serverStatus,
} from "./shared/rpc";

/** An editor tab polls every few seconds; one gone this long was closed or lost its connection. */
const ABANDONED_MS = 90_000;
/** Each session is a language server process; this bounds what a misbehaving client can start. */
const MAX_SESSIONS = 24;
/** Bytes of PDF per call: base64 makes it a third bigger, still far under the relay's limit. */
const PDF_CHUNK = 3 * 1024 * 1024;

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** The project root: the workspace directory when it contains the file, else the file's folder. */
async function projectRoot(file: string, root: string): Promise<string> {
  const inside = isAbsolute(root) && !relative(root, file).startsWith("..");
  if (inside && (await isDirectory(root))) return resolve(root);
  return dirname(file);
}

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(serverSettings);
  const sessions = new Map<string, EditorSession>();
  const installer = new Installer();
  const components = new Components(() => tool("npm"));
  const pdfjs = new PdfjsAssets(() => components.readyFolder("pdfjs"));
  const spelling = new Spelling(
    () => components.readyFolder("spelling"),
    personalWordsFile(dataRoot()),
  );

  async function locate(language: LanguageProfile) {
    const state = await settings.read();
    const configured =
      state.status === "ready" ? (state.values.servers[language.id]?.path ?? "") : "";
    const { binary, homepage, package: packageId } = language.server;
    return findServer({
      binary,
      configured,
      homepage,
      installed: () => installer.launch(packageId, binary),
    });
  }

  /** A tool an install needs (npm, go), found the way servers are. */
  async function tool(name: string): Promise<string | null> {
    try {
      return (await findServer({ binary: name, configured: "", homepage: "" })).path;
    } catch {
      return null;
    }
  }

  function session(id: string): EditorSession | null {
    return sessions.get(id) ?? null;
  }

  server.handle(openSession, async ({ language: languageId, file, root }) => {
    const language = languageById(languageId);
    if (!language) {
      return {
        ok: false as const,
        reason: "failed" as const,
        message: `This version of the plugin does not know the language "${languageId}".`,
      };
    }
    if (!isAbsolute(file)) {
      return {
        ok: false as const,
        reason: "failed" as const,
        message: `Not an absolute path: ${file}`,
      };
    }
    let binary;
    try {
      binary = await locate(language);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason: "missing" | "failed" =
        error instanceof ServerNotFoundError ? "missing" : "failed";
      return { ok: false as const, reason, message };
    }
    if (sessions.size >= MAX_SESSIONS) {
      return {
        ok: false as const,
        reason: "failed" as const,
        message: `Too many editors with language servers are open on this host (${MAX_SESSIONS}). Close some tabs.`,
      };
    }
    const rootPath = await projectRoot(file, root);
    const id = randomUUID();
    sessions.set(
      id,
      new EditorSession({
        id,
        command: binary.launch.command,
        args: [...binary.launch.args, ...language.server.args],
        env: binary.launch.env,
        name: language.server.name,
        root: rootPath,
        preview: language.preview,
      }),
    );
    return {
      ok: true as const,
      sessionId: id,
      rootUri: pathToFileURL(rootPath).href,
      fileUri: pathToFileURL(file).href,
      version: binary.version,
    };
  });

  server.handle(sendLsp, ({ sessionId, messages }) => ({
    alive: session(sessionId)?.sendLsp(messages) ?? false,
  }));

  server.handle(pollSession, async ({ sessionId, waitMs }) => {
    const found = session(sessionId);
    if (!found) return { alive: false, exit: "The session ended.", lsp: [], preview: [] };
    const result = await found.poll(waitMs);
    if (!result.alive) sessions.delete(sessionId);
    return result;
  });

  server.handle(connectPreview, async ({ sessionId, port, includeHtml }) => {
    const found = session(sessionId);
    if (!found) throw new Error("The session ended.");
    return { html: await found.connectPreview(port, includeHtml) };
  });

  server.handle(sendPreview, ({ sessionId, messages }) => ({
    alive: session(sessionId)?.sendPreview(messages) ?? false,
  }));

  server.handle(closeSession, ({ sessionId }) => {
    session(sessionId)?.close();
    sessions.delete(sessionId);
    return {};
  });

  server.handle(serverStatus, async ({ language: languageId }) => {
    const language = languageById(languageId);
    const none = {
      path: null,
      version: null,
      source: null,
      install: null,
      installUnavailable: null,
      installed: null,
      job: null,
    };
    if (!language) return { ...none, error: `Unknown language ${languageId}.` };
    const packageId = language.server.package;
    const planned = planInstall(packageId);
    const installed = await installer.installed(packageId);
    const job = installer.job(packageId);
    const extras = {
      install: planned.ok ? planned.plan : null,
      installUnavailable: planned.ok ? null : planned.reason,
      installed,
      job: job && { phase: job.phase, received: job.received, total: job.total, error: job.error },
    };
    try {
      const binary = await locate(language);
      return {
        ...extras,
        path: binary.path,
        version: binary.version,
        source: binary.source,
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ...extras, path: null, version: null, source: null, error: message };
    }
  });

  // --- Previews rendered or built on this host.

  server.handle(renderMarkdown, ({ file, text }) => render(file, text));

  server.handle(locatePdf, async ({ file }) => {
    const root = await latexRoot(file);
    return { root, pdf: pdfFor(root) };
  });

  server.handle(statPdf, async ({ path }) => {
    try {
      const info = await stat(path);
      return { exists: info.isFile(), mtimeMs: info.mtimeMs, size: info.size };
    } catch {
      return { exists: false, mtimeMs: 0, size: 0 };
    }
  });

  server.handle(readPdf, async ({ path, offset }) => {
    const handle = await open(path, "r");
    try {
      const info = await handle.stat();
      const length = Math.max(0, Math.min(PDF_CHUNK, info.size - offset));
      const buffer = Buffer.alloc(length);
      if (length > 0) await handle.read(buffer, 0, length, offset);
      return { data: buffer.toString("base64"), total: info.size, mtimeMs: info.mtimeMs };
    } finally {
      await handle.close();
    }
  });

  server.handle(synctexForward, async ({ pdf, file, line, column }) => {
    const synctex = await tool("synctex");
    if (!synctex) return { boxes: [], error: "synctex was not found on the daemon host." };
    try {
      return { boxes: await forward(synctex, pdf, file, line, column), error: null };
    } catch (error) {
      return { boxes: [], error: error instanceof Error ? error.message : String(error) };
    }
  });

  server.handle(synctexInverse, async ({ pdf, page, x, y }) => {
    const empty = { file: null, line: null, column: null };
    const synctex = await tool("synctex");
    if (!synctex) return { ...empty, error: "synctex was not found on the daemon host." };
    try {
      const found = await inverse(synctex, pdf, page, x, y);
      return found ? { ...found, error: null } : { ...empty, error: null };
    } catch (error) {
      return { ...empty, error: error instanceof Error ? error.message : String(error) };
    }
  });

  server.handle(pdfjsPart, ({ part }) => pdfjs.part(part));
  server.handle(pdfjsBinary, ({ kind, filename }) => pdfjs.binary(kind, filename));

  // --- Components downloaded on first use, and spelling.

  server.handle(componentStatusRpc, ({ id, install, retry }) =>
    install ? components.ensure(id, retry ?? false) : components.status(id),
  );

  server.handle(removeComponent, async ({ id }) => {
    await components.remove(id);
    return {};
  });

  server.handle(checkSpelling, async ({ file, words }) => {
    const status = await components.ensure("spelling");
    if (status.state !== "ready") return { state: status.state, error: status.error, issues: [] };
    try {
      return { state: status.state, error: null, issues: await spelling.check(file, words) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { state: "failed" as const, error: message, issues: [] };
    }
  });

  server.handle(suggestSpelling, async ({ file, word }) => {
    try {
      return { suggestions: await spelling.suggest(file, word), error: null };
    } catch (error) {
      return { suggestions: [], error: error instanceof Error ? error.message : String(error) };
    }
  });

  server.handle(addSpellingWord, async ({ word }) => {
    try {
      await spelling.addWord(word);
      return { error: null };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  server.handle(installServer, async ({ language: languageId }) => {
    const language = languageById(languageId);
    if (!language) return { started: false, error: `Unknown language ${languageId}.` };
    const planned = planInstall(language.server.package);
    if (!planned.ok) return { started: false, error: planned.reason };
    const needs = planned.plan.needs;
    const tools = {
      npm: needs === "npm" ? await tool("npm") : null,
      go: needs === "go" ? await tool("go") : null,
    };
    if (needs && !tools[needs]) {
      return {
        started: false,
        error: `Installing ${planned.plan.name} needs ${needs === "go" ? "Go" : "npm"} on the daemon host.`,
      };
    }
    installer.start(language.server.package, tools);
    return { started: true, error: null };
  });

  server.handle(removeServer, async ({ language: languageId }) => {
    const language = languageById(languageId);
    if (language) await installer.remove(language.server.package);
    return {};
  });

  const reaper = setInterval(() => {
    const cutoff = Date.now() - ABANDONED_MS;
    for (const [id, found] of sessions) {
      if (found.lastSeen < cutoff) {
        found.close();
        sessions.delete(id);
      }
    }
  }, 15_000);
  reaper.unref();

  return () => {
    clearInterval(reaper);
    for (const found of sessions.values()) found.close();
    sessions.clear();
  };
}
