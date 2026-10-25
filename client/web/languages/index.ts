import type { Extension } from "@codemirror/state";
import type { LanguageTags } from "../theme";
import { typst } from "./typst";

/** A language's CodeMirror side: its parser and support, and the extra tags it highlights. */
export interface EditorLanguage extends LanguageTags {
  support(): Extension;
}

const LANGUAGES: Record<string, EditorLanguage> = { typst };

/** Plain text for a language without CodeMirror support. */
const PLAIN: EditorLanguage = { support: () => [], tags: [] };

export function editorLanguage(id: string): EditorLanguage {
  return LANGUAGES[id] ?? PLAIN;
}
