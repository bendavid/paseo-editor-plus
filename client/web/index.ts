import type { WebModules } from "../web-contract";
import { createLanguageClient, createTypstEditor } from "./editor";
import { mountPreview } from "./preview";

/** Everything the panel needs from the DOM, loaded only on web. */
export const webModules: WebModules = { createTypstEditor, createLanguageClient, mountPreview };
