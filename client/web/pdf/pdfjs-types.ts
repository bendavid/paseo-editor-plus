// The parts of PDF.js's API the LaTeX preview uses. PDF.js is downloaded into plugin-data on first
// use rather than installed with the plugin, and Paseo checks every type import against the
// plugin's installed packages, so these stand in for pdfjs-dist's own declarations.
// test/pdfjs-types.test.ts checks them against pdfjs-dist.

export interface PdfDocument {
  numPages: number;
  loadingTask: { destroy(): Promise<void> };
}

export interface GetDocumentParameters {
  data: Uint8Array;
  useWorkerFetch: boolean;
  BinaryDataFactory: new () => {
    fetch(input: { kind: string; filename: string }): Promise<Uint8Array>;
  };
  cMapPacked: boolean;
  isEvalSupported: boolean;
  enableXfa: boolean;
}

export interface PdfjsLibModule {
  getDocument(parameters: GetDocumentParameters): { promise: Promise<PdfDocument> };
  GlobalWorkerOptions: { workerPort: Worker | null };
}

export interface PdfEventBus {
  on(name: string, listener: (event: never) => void): void;
  off(name: string, listener: (event: never) => void): void;
}

export interface PdfPageView {
  div: HTMLDivElement;
  pdfPage?: { view: number[] };
  viewport: {
    convertToPdfPoint(x: number, y: number): number[];
    convertToViewportPoint(x: number, y: number): number[];
  };
}

export interface PdfViewer {
  currentScale: number;
  currentScaleValue: string;
  setDocument(document: PdfDocument | null): void;
  getPageView(index: number): PdfPageView | undefined;
  scrollPageIntoView(params: {
    pageNumber: number;
    destArray: unknown[];
    allowNegativeOffset: boolean;
  }): void;
  increaseScale(options: { steps: number }): void;
  decreaseScale(options: { steps: number }): void;
  update(): void;
}

export interface PdfLinkService {
  setViewer(viewer: PdfViewer): void;
  setDocument(document: PdfDocument, baseUrl?: null): void;
}

export interface PdfjsViewerModule {
  EventBus: new () => PdfEventBus;
  PDFLinkService: new (options: {
    eventBus: PdfEventBus;
    externalLinkTarget: number;
  }) => PdfLinkService;
  PDFViewer: new (options: {
    container: HTMLDivElement;
    viewer: HTMLDivElement;
    eventBus: PdfEventBus;
    linkService: PdfLinkService;
  }) => PdfViewer;
  LinkTarget: { BLANK: number };
}
