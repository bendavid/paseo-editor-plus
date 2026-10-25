import type { PreviewKind } from "../../shared/languages";
import { tinymistPreview } from "./tinymist";
import type { PreviewProvider } from "./types";

export function previewProvider(kind: PreviewKind | null): PreviewProvider | null {
  switch (kind) {
    case "tinymist":
      return tinymistPreview;
    case null:
      return null;
  }
}
