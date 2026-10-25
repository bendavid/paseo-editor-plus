import type { PreviewKind } from "../../shared/languages";
import { latexPdfPreview } from "./latex-pdf";
import { markdownPreview } from "./markdown";
import { tinymistPreview } from "./tinymist";
import type { PreviewProvider } from "./types";

export function previewProvider(kind: PreviewKind | null): PreviewProvider | null {
  switch (kind) {
    case "tinymist":
      return tinymistPreview;
    case "markdown":
      return markdownPreview;
    case "latex-pdf":
      return latexPdfPreview;
    case null:
      return null;
  }
}
