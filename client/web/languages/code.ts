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

const COMMENTS = { kind: "comments" } as const;

const plain = (
  support: EditorLanguage["support"],
  spelling: EditorLanguage["spelling"] = COMMENTS,
): EditorLanguage => ({ support, tags: [], spelling });

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
/** LaTeX commands whose first so many arguments are names, keys, or paths; stex reads them as text. */
const LATEX_NAME_ARGUMENTS: Record<string, number> = {
  documentclass: 1,
  usepackage: 1,
  RequirePackage: 1,
  input: 1,
  include: 1,
  includeonly: 1,
  includegraphics: 1,
  bibliography: 1,
  bibliographystyle: 1,
  addbibresource: 1,
  begin: 2,
  end: 1,
  label: 1,
  ref: 1,
  eqref: 1,
  pageref: 1,
  autoref: 1,
  cref: 1,
  Cref: 1,
  cite: 1,
  citep: 1,
  citet: 1,
  citeauthor: 1,
  nocite: 1,
  url: 1,
  href: 1,
  newcommand: 2,
  renewcommand: 2,
  newenvironment: 3,
  renewenvironment: 3,
  setlength: 2,
  usetikzlibrary: 1,
  definecolor: 3,
  color: 1,
  textcolor: 1,
  hypersetup: 1,
  geometry: 1,
};

// `begin` skips two groups for `\begin{tabular}{lcr}`; only a group right after the environment
// name counts, so text on the next line is still checked.
export const latex_ = plain(() => StreamLanguage.define(stex), {
  kind: "markup",
  arguments: LATEX_NAME_ARGUMENTS,
});
// Marp decks open with YAML front matter, which the Markdown grammar reads as text.
export const markdown_ = plain(() => markdown(), { kind: "markup", frontmatter: true });
export const json_ = plain(() => json());
export const css_ = plain((extension) => {
  if (extension === "scss") return sass();
  if (extension === "less") return less();
  return css();
});
export const html_ = plain(() => html());
