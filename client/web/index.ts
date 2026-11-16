import type { WebModules } from "../web-contract";
import { mountDocumentPreview } from "./document-preview";
import { createEditor, createLanguageClient } from "./editor";
import { mountPdfPreview } from "./pdf/viewer";
import { mountPreview } from "./preview";
import { dockSplit, resizeSplit } from "./split";

/** Everything the panel needs from the DOM, loaded only on web. */
export const webModules: WebModules = {
  createEditor,
  createLanguageClient,
  mountPreview,
  mountDocumentPreview,
  mountPdfPreview,
  resizeSplit,
  dockSplit,
};
