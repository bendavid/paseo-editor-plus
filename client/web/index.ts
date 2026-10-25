import type { WebModules } from "../web-contract";
import { mountDocumentPreview } from "./document-preview";
import { createEditor, createLanguageClient } from "./editor";
import { mountPdfPreview } from "./pdf/viewer";
import { mountPreview } from "./preview";
import { dockSplit, resizeSplit } from "./split";

/** Everything the panel needs from the DOM, loaded only on web. */
function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export const webModules: WebModules = {
  decodeBase64,
  createEditor,
  createLanguageClient,
  mountPreview,
  mountDocumentPreview,
  mountPdfPreview,
  resizeSplit,
  dockSplit,
};
