import type * as PdfjsLib from "pdfjs-dist";
import type * as Viewer from "pdfjs-dist/web/pdf_viewer.mjs";
import type {
  PdfEventBus,
  PdfjsLibModule,
  PdfLinkService,
  PdfViewer,
  PdfjsViewerModule,
} from "./pdfjs-types";

// Compiled by `npm run typecheck` only; nothing imports it, so Paseo never sees pdfjs-dist. It
// fails to compile when pdfjs-dist no longer matches the subset in pdfjs-types.ts.

type Is<Actual, Expected> = Actual extends Expected ? true : false;

export const lib: Is<typeof PdfjsLib, PdfjsLibModule> = true;
// PDF.js's classes have private fields, so its constructors accept only its own objects, which
// is what the preview passes them. Check the instances and the options built from them.
export const eventBus: Is<Viewer.EventBus, PdfEventBus> = true;
export const viewer: Is<Viewer.PDFViewer, PdfViewer> = true;
export const linkService: Is<Viewer.PDFLinkService, PdfLinkService> = true;
export const linkTarget: Is<typeof Viewer.LinkTarget, PdfjsViewerModule["LinkTarget"]> = true;
export const linkServiceOptions: Is<
  { eventBus: Viewer.EventBus; externalLinkTarget: number },
  ConstructorParameters<typeof Viewer.PDFLinkService>[0]
> = true;
export const viewerOptions: Is<
  {
    container: HTMLDivElement;
    viewer: HTMLDivElement;
    eventBus: Viewer.EventBus;
    linkService: Viewer.PDFLinkService;
  },
  ConstructorParameters<typeof Viewer.PDFViewer>[0]
> = true;
