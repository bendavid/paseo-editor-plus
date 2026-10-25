import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { less } from "@codemirror/lang-less";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sass } from "@codemirror/lang-sass";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import type { EditorLanguage } from "./index";

// The official CodeMirror grammars for the general-purpose languages, and the legacy stex mode
// for LaTeX (there is no Lezer grammar for it). They colour the text as it is typed; the
// language server's semantic tokens refine the colours once it has analysed the file.

const plain = (support: EditorLanguage["support"]): EditorLanguage => ({ support, tags: [] });

export const python_ = plain(() => python());
export const rust_ = plain(() => rust());
export const go_ = plain(() => go());
export const cpp_ = plain(() => cpp());
export const javascript_ = plain((extension) =>
  javascript({
    jsx: extension === "jsx" || extension === "tsx",
    typescript: ["ts", "mts", "cts", "tsx"].includes(extension),
  }),
);
export const latex_ = plain(() => StreamLanguage.define(stex));
export const markdown_ = plain(() => markdown());
export const json_ = plain(() => json());
export const css_ = plain((extension) => {
  if (extension === "scss") return sass();
  if (extension === "less") return less();
  return css();
});
export const html_ = plain(() => html());
