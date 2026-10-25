import type { Extension } from "@codemirror/state";
import type { SpellingRules } from "../spelling";
import type { LanguageTags } from "../theme";
import {
  cpp_,
  css_,
  go_,
  html_,
  javascript_,
  json_,
  latex_,
  markdown_,
  python_,
  rust_,
} from "./code";
import { typst } from "./typst";

/** A language's CodeMirror side: its parser and support, and the extra tags it highlights. */
export interface EditorLanguage extends LanguageTags {
  /** The support for a file with this extension (lowercase, without the dot). */
  support(extension: string): Extension;
  /** Which parts of a file the spellchecker reads. */
  spelling: SpellingRules;
}

const LANGUAGES: Record<string, EditorLanguage> = {
  typst,
  python: python_,
  rust: rust_,
  go: go_,
  cpp: cpp_,
  javascript: javascript_,
  latex: latex_,
  markdown: markdown_,
  json: json_,
  css: css_,
  html: html_,
};

/** Plain text for a language without CodeMirror support. */
const PLAIN: EditorLanguage = { support: () => [], tags: [], spelling: { kind: "markup" } };

export function editorLanguage(id: string): EditorLanguage {
  return LANGUAGES[id] ?? PLAIN;
}
