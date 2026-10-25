import type { PreviewKind } from "../../shared/languages";
import { tinymistPreviewPorts } from "./tinymist";

/**
 * The ports a preview announced in a message from the language server. Only these may be
 * connected to: the app names a port, and the server checks it came from this session.
 */
export function announcedPreviewPorts(kind: PreviewKind | null, message: string): number[] {
  switch (kind) {
    case "tinymist":
      return tinymistPreviewPorts(message);
    case "markdown":
    case "latex-pdf":
    case null:
      return [];
  }
}
