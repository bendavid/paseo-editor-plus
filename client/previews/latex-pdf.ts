import { componentMessage } from "../../shared/components";
import { PDF_CHUNK } from "../../shared/rpc";
import type { PreviewProvider } from "./types";

// LaTeX: the PDF the build writes (latexmk through texlab, with SyncTeX), reloaded when the daemon
// reports it changed, linked to the source with SyncTeX on the daemon host. It shows a built file,
// so it needs no language server; building does.

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
    let shown = -1;
    let destroyed = false;
    let waitingMessage = true;
    /** The PDF's latest state; shown once PDF.js is installed and no read is under way. */
    let latest: { exists: boolean; mtimeMs: number; size: number } | null = null;
    let reading = false;

    // PDF.js is installed into plugin-data once the user agrees; the panel's banner asks, and the
    // PDF shows as soon as the install finishes.
    let runtimeReady = false;
    const stopRuntime = calls.componentChanges({ id: "pdfjs" }, (status) => {
      if (status.state === "ready") {
        if (runtimeReady) return;
        runtimeReady = true;
        // Show the PDF's state again, over the download's message.
        shown = -1;
        void show();
        return;
      }
      runtimeReady = false;
      if (status.state === "missing") {
        services.requestComponent("pdfjs");
        view.message("The LaTeX preview needs PDF.js. Install it from the banner above.");
      } else {
        view.message(componentMessage(status) ?? "");
      }
    });

    const read = async (size: number): Promise<Uint8Array> => {
      const bytes = new Uint8Array(size);
      let offset = 0;
      while (offset < size) {
        const chunk = await calls.readPdf({ path: pdf, offset });
        if (chunk.length === 0) break;
        // The build rewrote the file while it was read; the change that follows reads it again.
        if (offset + chunk.length > size) throw new Error("The PDF changed while it was read.");
        bytes.set(chunk, offset);
        offset += chunk.length;
        if (chunk.length < PDF_CHUNK) break;
      }
      return offset === size ? bytes : bytes.subarray(0, offset);
    };

    const show = async () => {
      if (reading || destroyed || !latest) return;
      reading = true;
      try {
        while (!destroyed && latest && latest.mtimeMs !== shown) {
          const state = latest;
          if (!state.exists) {
            if (waitingMessage) {
              view.message(
                `No PDF yet (${pdf.split(/[\\/]/).pop()}). Turn on “Compile to PDF on save” in the plugin's settings, or build with the toolbar's Compile button.`,
              );
            }
            shown = state.mtimeMs;
            break;
          }
          if (!runtimeReady) break;
          const bytes = await read(state.size);
          if (destroyed) return;
          await view.open(bytes);
          shown = state.mtimeMs;
          waitingMessage = false;
        }
      } catch (error) {
        // A PDF read while latexmk writes it fails to parse; its next change reads it again.
        if (waitingMessage) view.message(`The PDF could not be shown yet: ${String(error)}`);
      } finally {
        reading = false;
      }
    };

    const stopWatching = calls.pdfChanges({ path: pdf }, (state) => {
      latest = state;
      void show();
    });

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
      saved() {},
      setInvert: (invert) => view.setInvert(invert),
      setTheme: (theme) => view.setTheme(theme),
      destroy() {
        destroyed = true;
        stopWatching();
        stopRuntime();
        view.destroy();
      },
    };
  },

  sourceJump: () => null,
  swallows: () => false,
};
