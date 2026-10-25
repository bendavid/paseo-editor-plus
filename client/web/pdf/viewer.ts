import type { PluginTheme } from "@getpaseo/plugin";
import { SCOPE_CLASS } from "../../css-scope";
import type { PdfPreviewOptions, PdfPreviewView, SyncBox } from "../../web-contract";
import type { PdfDocument, PdfEventBus, PdfViewer } from "./pdfjs-types";
import { binaryDataFactoryFor, loadPdfjsRuntime, type PdfjsRuntime } from "./runtime";

// The LaTeX preview: the built PDF in PDF.js, reloaded in place after each build, linked to the
// source with SyncTeX. A trimmed-down version of the pdfjs-viewer plugin's controller.

interface Layer {
  container: HTMLDivElement;
  eventBus: PdfEventBus;
  viewer: PdfViewer;
  document: PdfDocument;
  location: { pageNumber: number; left: number; top: number; scale: string } | null;
}

/** How long a new build may take to draw before it replaces the old one anyway. */
const SWAP_TIMEOUT_MS = 2000;

function once(eventBus: PdfEventBus, name: string): Promise<void> {
  return new Promise((resolve) => {
    const listener = () => {
      eventBus.off(name, listener);
      resolve();
    };
    eventBus.on(name, listener);
  });
}

export function mountPdfPreview(
  parentElement: unknown,
  options: PdfPreviewOptions,
): PdfPreviewView {
  const parent = parentElement as HTMLElement;
  const root = document.createElement("div");
  root.className = SCOPE_CLASS;
  Object.assign(root.style, { position: "absolute", inset: "0", overflow: "hidden" });
  parent.appendChild(root);
  const messageElement = document.createElement("div");
  messageElement.className = "editor-plus-pdf-message";
  root.appendChild(messageElement);

  let runtime: Promise<PdfjsRuntime> | null = null;
  let current: Layer | null = null;
  let sequence = 0;
  let destroyed = false;
  let scaleValue = "page-width";

  const setTheme = (theme: PluginTheme) => {
    root.style.backgroundColor = theme.colors.surface1;
    root.style.setProperty("--editor-plus-accent", theme.colors.accent);
    root.style.setProperty("--editor-plus-muted", theme.colors.foregroundMuted);
  };
  setTheme(options.theme);
  root.classList.toggle("editor-plus-pdf-invert", options.invert);

  const loadRuntime = () => {
    runtime ??= loadPdfjsRuntime(options.fetchRuntimePart);
    return runtime;
  };

  function pageHeight(layer: Layer, page: number): number {
    const view = layer.viewer.getPageView(page - 1)?.pdfPage?.view;
    return view ? view[3] - view[1] : 792;
  }

  const onPointer = (layer: Layer) => (event: MouseEvent) => {
    if (event.type === "click" && !(event.ctrlKey || event.metaKey)) return;
    const pageElement = (event.target as Element | null)?.closest?.(".page") as HTMLElement | null;
    const page = Number(pageElement?.dataset.pageNumber);
    if (!pageElement || !page) return;
    const pageView = layer.viewer.getPageView(page - 1);
    if (!pageView) return;
    const box = pageElement.getBoundingClientRect();
    const [x, y] = pageView.viewport.convertToPdfPoint(
      event.clientX - box.left - pageElement.clientLeft,
      event.clientY - box.top - pageElement.clientTop,
    );
    event.preventDefault();
    options.onPoint(page, x, pageHeight(layer, page) - y);
  };

  function createLayer(rt: PdfjsRuntime, pdfDocument: PdfDocument): Layer {
    const container = document.createElement("div");
    container.className = "editor-plus-pdf-container";
    container.tabIndex = 0;
    container.style.visibility = "hidden";
    const viewerElement = document.createElement("div");
    viewerElement.className = "pdfViewer";
    container.appendChild(viewerElement);
    root.appendChild(container);
    const { EventBus, PDFLinkService, PDFViewer, LinkTarget } = rt.viewer;
    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK });
    const viewer = new PDFViewer({ container, viewer: viewerElement, eventBus, linkService });
    linkService.setViewer(viewer);
    const layer: Layer = { container, eventBus, viewer, document: pdfDocument, location: null };
    eventBus.on("updateviewarea", ({ location }: { location: Layer["location"] }) => {
      layer.location = location;
    });
    eventBus.on(
      "scalechanging",
      ({ presetValue, scale }: { presetValue?: string; scale: number }) => {
        if (layer === current) scaleValue = presetValue ?? String(scale);
      },
    );
    const pointer = onPointer(layer);
    container.addEventListener("dblclick", pointer);
    container.addEventListener("click", pointer);
    container.addEventListener(
      "wheel",
      (event) => {
        if (!(event.ctrlKey || event.metaKey) || event.deltaY === 0) return;
        event.preventDefault();
        if (event.deltaY < 0) viewer.increaseScale({ steps: 1 });
        else viewer.decreaseScale({ steps: 1 });
      },
      { passive: false },
    );
    viewer.setDocument(pdfDocument);
    linkService.setDocument(pdfDocument, null);
    return layer;
  }

  function destroyLayer(layer: Layer): void {
    layer.viewer.setDocument(null);
    void layer.document.loadingTask.destroy();
    layer.container.remove();
  }

  const resize = new ResizeObserver(() => {
    const viewer = current?.viewer;
    if (!viewer) return;
    if (!Number(viewer.currentScaleValue)) viewer.currentScaleValue = viewer.currentScaleValue;
    viewer.update();
  });
  resize.observe(root);

  return {
    async open(bytes) {
      const mine = ++sequence;
      const rt = await loadRuntime();
      const pdfDocument = await rt.lib.getDocument({
        data: bytes,
        useWorkerFetch: false,
        BinaryDataFactory: binaryDataFactoryFor(options.fetchBinaryData),
        cMapPacked: true,
        isEvalSupported: false,
        enableXfa: false,
      }).promise;
      if (destroyed || mine !== sequence) {
        void pdfDocument.loadingTask.destroy();
        return;
      }
      const previous = current;
      const place = previous?.location ?? null;
      const layer = createLayer(rt, pdfDocument);
      await once(layer.eventBus, "pagesinit");
      layer.viewer.currentScaleValue = scaleValue;
      if (place) {
        const page = Math.min(place.pageNumber, pdfDocument.numPages);
        layer.viewer.scrollPageIntoView({
          pageNumber: page,
          destArray: [null, { name: "XYZ" }, place.left, place.top, null],
          allowNegativeOffset: true,
        });
      }
      if (previous)
        await Promise.race([
          once(layer.eventBus, "pagerendered"),
          new Promise((r) => setTimeout(r, SWAP_TIMEOUT_MS)),
        ]);
      if (destroyed || mine !== sequence) {
        destroyLayer(layer);
        return;
      }
      layer.container.style.visibility = "";
      if (previous) destroyLayer(previous);
      current = layer;
      messageElement.style.display = "none";
    },
    message(text) {
      messageElement.textContent = text ?? "";
      messageElement.style.display = text ? "" : "none";
    },
    highlight(boxes: SyncBox[]) {
      const layer = current;
      if (!layer || boxes.length === 0) return;
      const first = boxes[0];
      const height = pageHeight(layer, first.page);
      // Put the line a third of the way down the view.
      const above = layer.container.clientHeight / 3 / (layer.viewer.currentScale || 1);
      layer.viewer.scrollPageIntoView({
        pageNumber: first.page,
        destArray: [null, { name: "XYZ" }, null, height - first.y + above, null],
        allowNegativeOffset: true,
      });
      for (const box of boxes.filter((b) => b.page === first.page)) {
        const pageView = layer.viewer.getPageView(box.page - 1);
        if (!pageView) continue;
        // PDF space has its origin at the bottom-left; SyncTeX boxes are from the top-left.
        const [x1, y1] = pageView.viewport.convertToViewportPoint(
          box.x,
          height - box.y - box.height,
        );
        const [x2, y2] = pageView.viewport.convertToViewportPoint(
          box.x + box.width,
          height - box.y,
        );
        const mark = document.createElement("div");
        mark.className = "editor-plus-pdf-sync";
        Object.assign(mark.style, {
          left: `${Math.min(x1, x2) - 2}px`,
          top: `${Math.min(y1, y2) - 2}px`,
          width: `${Math.abs(x2 - x1) + 4}px`,
          height: `${Math.abs(y2 - y1) + 4}px`,
        });
        pageView.div.appendChild(mark);
        setTimeout(() => mark.remove(), 2600);
      }
    },
    setInvert(invert) {
      root.classList.toggle("editor-plus-pdf-invert", invert);
    },
    setTheme,
    destroy() {
      destroyed = true;
      resize.disconnect();
      if (current) destroyLayer(current);
      current = null;
      root.remove();
    },
  };
}
