import { componentMessage } from "../../shared/components";
import type { PreviewProvider } from "./types";

// LaTeX: the PDF the build writes (latexmk through texlab, with SyncTeX), reloaded when it
// changes, linked to the source with SyncTeX on the daemon host. It shows a built file, so it needs
// no language server; building does.

/** How often to check whether the build wrote a new PDF. */
const CHECK_MS = 1500;

export const latexPdfPreview: PreviewProvider = {
  needsServer: false,

  async start(services) {
    const { calls, filePath, web } = services;
    const { pdf } = await calls.locatePdf({ file: filePath });
    const view = web.mountPdfPreview(services.parent, {
      theme: services.theme,
      invert: services.invert,
      fetchRuntimePart: (input) => calls.pdfjsPart(input),
      fetchBinaryData: (input) => calls.pdfjsBinary(input),
      onPoint: (page, x, y) => {
        void calls.synctexInverse({ pdf, page, x, y }).then((found) => {
          if (found.error) services.notice(found.error);
          else if (found.file && found.line) {
            services.jump({
              path: found.file,
              start: { line: found.line - 1, character: Math.max(0, found.column ?? 0) },
              end: null,
            });
          }
        });
      },
    });
    let shown = 0;
    let checking = false;
    let destroyed = false;
    let waitingMessage = true;

    // PDF.js is installed into plugin-data once the user agrees; the panel's banner asks.
    let runtimeReady = false;
    const ensureRuntime = async (): Promise<boolean> => {
      if (runtimeReady) return true;
      const status = await calls.componentStatus({ id: "pdfjs", install: false });
      if (status.state === "missing") {
        services.requestComponent("pdfjs");
        view.message("The LaTeX preview needs PDF.js. Install it from the banner above.");
        return false;
      }
      const message = componentMessage(status);
      if (message) {
        view.message(message);
        return false;
      }
      runtimeReady = true;
      return true;
    };

    const read = async (): Promise<{ bytes: Uint8Array; mtimeMs: number }> => {
      const parts: Uint8Array[] = [];
      let offset = 0;
      let total = Infinity;
      let mtimeMs = 0;
      while (offset < total) {
        const chunk = await calls.readPdf({ path: pdf, offset });
        total = chunk.total;
        mtimeMs = chunk.mtimeMs;
        const bytes = web.decodeBase64(chunk.data);
        if (bytes.length === 0) break;
        parts.push(bytes);
        offset += bytes.length;
      }
      const bytes = new Uint8Array(offset);
      let at = 0;
      for (const part of parts) {
        bytes.set(part, at);
        at += part.length;
      }
      return { bytes, mtimeMs };
    };

    const check = async () => {
      if (checking || destroyed) return;
      checking = true;
      try {
        const info = await calls.statPdf({ path: pdf });
        if (!info.exists) {
          if (waitingMessage) {
            view.message(
              `No PDF yet (${pdf.split(/[\\/]/).pop()}). Turn on “Compile to PDF on save” in the plugin's settings, or build with the toolbar's Compile button.`,
            );
          }
          return;
        }
        if (info.mtimeMs === shown) return;
        if (!(await ensureRuntime())) return;
        const { bytes, mtimeMs } = await read();
        if (destroyed) return;
        await view.open(bytes);
        shown = mtimeMs;
        waitingMessage = false;
      } catch (error) {
        // A PDF read while latexmk writes it fails to parse; the next check reads it again.
        if (shown === 0) view.message(`The PDF could not be shown yet: ${String(error)}`);
      } finally {
        checking = false;
      }
    };
    await ensureRuntime().catch(() => false);
    await check();
    const timer = setInterval(() => void check(), CHECK_MS);

    return {
      deliver() {},
      reveal(position) {
        void calls
          .synctexForward({
            pdf,
            file: filePath,
            line: position.line + 1,
            column: position.character,
          })
          .then((result) => {
            if (result.boxes.length > 0) view.highlight(result.boxes);
          });
      },
      textChanged() {},
      saved: () => void check(),
      setInvert: (invert) => view.setInvert(invert),
      setTheme: (theme) => view.setTheme(theme),
      destroy() {
        destroyed = true;
        clearInterval(timer);
        view.destroy();
      },
    };
  },

  sourceJump: () => null,
  swallows: () => false,
};
