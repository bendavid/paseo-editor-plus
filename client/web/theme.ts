import type { PluginTheme } from "@getpaseo/plugin";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags, type Tag } from "@lezer/highlight";
import { isDark } from "../colors";

// One palette for both highlighting layers: the grammar's tags and the language server's
// semantic token classes (`cm-sem-<type>`, `cm-sem-m-<modifier>`). When the server's tokens
// arrive over the grammar's, the colours should not change.

interface Palette {
  keyword: string;
  fn: string;
  type: string;
  string: string;
  number: string;
  comment: string;
  heading: string;
  label: string;
  math: string;
  muted: string;
  error: string;
  /** Links in hover documentation. */
  link: string;
}

const LIGHT: Palette = {
  keyword: "#7c3aed",
  fn: "#1d4ed8",
  type: "#0f766e",
  string: "#15803d",
  number: "#b45309",
  comment: "#6b7280",
  heading: "#b91c1c",
  label: "#0e7490",
  math: "#be185d",
  muted: "#64748b",
  error: "#dc2626",
  link: "#1d4ed8",
};

const DARK: Palette = {
  keyword: "#c792ea",
  fn: "#82aaff",
  type: "#4fd6be",
  string: "#c3e88d",
  number: "#f78c6c",
  comment: "#7f848e",
  heading: "#ffcb6b",
  label: "#89ddff",
  math: "#f07178",
  muted: "#94a3b8",
  error: "#ff5370",
  link: "#8ab4ff",
};

function palette(theme: PluginTheme): Palette {
  return isDark(theme) ? DARK : LIGHT;
}

/** Grammar highlighting. `extra` adds tags a language defines, such as Typst's list markers. */
function highlightStyle(c: Palette, extra: readonly { tag: Tag | Tag[]; color: string }[]) {
  return HighlightStyle.define([
    {
      tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword],
      color: c.keyword,
    },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: c.fn },
    { tag: [tags.propertyName, tags.variableName], color: c.fn },
    { tag: [tags.typeName, tags.className, tags.namespace], color: c.type },
    { tag: [tags.string, tags.special(tags.string)], color: c.string },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: c.number },
    { tag: tags.comment, color: c.comment, fontStyle: "italic" },
    { tag: tags.heading, color: c.heading, fontWeight: "bold" },
    { tag: tags.strong, fontWeight: "bold" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: [tags.labelName, tags.link, tags.url], color: c.label },
    { tag: tags.escape, color: c.label },
    { tag: tags.monospace, color: c.string },
    { tag: [tags.operator, tags.punctuation, tags.paren, tags.bracket], color: c.muted },
    { tag: tags.invalid, color: c.error, textDecoration: "underline wavy" },
    ...extra,
  ]);
}

/** Colours for semantic token types: the LSP standard names plus tinymist's own. */
function semanticTheme(c: Palette) {
  return EditorView.theme({
    ".cm-sem-keyword, .cm-sem-modifier, .cm-sem-macro": { color: c.keyword },
    ".cm-sem-function, .cm-sem-method, .cm-sem-variable, .cm-sem-parameter, .cm-sem-property": {
      color: c.fn,
    },
    ".cm-sem-decorator": { color: c.keyword },
    ".cm-sem-type, .cm-sem-class, .cm-sem-namespace, .cm-sem-enum, .cm-sem-interface, .cm-sem-struct":
      { color: c.type },
    ".cm-sem-string, .cm-sem-raw, .cm-sem-regexp": { color: c.string },
    ".cm-sem-number, .cm-sem-bool, .cm-sem-enumMember": { color: c.number },
    ".cm-sem-comment": { color: c.comment, fontStyle: "italic" },
    ".cm-sem-heading": { color: c.heading, fontWeight: "bold" },
    ".cm-sem-label, .cm-sem-ref, .cm-sem-link, .cm-sem-escape": { color: c.label },
    ".cm-sem-operator, .cm-sem-marker, .cm-sem-term": { color: c.keyword },
    ".cm-sem-error": { color: c.error },
    ".cm-sem-pol": { color: c.fn },
    ".cm-sem-m-strong": { fontWeight: "bold" },
    ".cm-sem-m-emph": { fontStyle: "italic" },
    ".cm-sem-m-math": { color: c.math },
  });
}

export interface LanguageTags {
  /** Extra grammar tags and their palette colour names. */
  tags: readonly { tag: Tag | Tag[]; color: keyof Palette }[];
}

const MONOSPACE = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif";

/** The editor's text size; tooltips and menus use it too. */
export const EDITOR_FONT_SIZE_PX = 13;

/** The editor's look: its chrome, text size, the grammar's highlighting, and semantic tokens. */
export function editorTheme(theme: PluginTheme, language: LanguageTags): Extension {
  const { colors } = theme;
  const c = palette(theme);
  const dark = isDark(theme);
  return [
    EditorView.theme(
      {
        // One text size for the editor; tooltips and menus follow it. Tooltips live in a container
        // in document.body that carries the theme's classes too, so "&" holds only what both share.
        "&": {
          "--editor-plus-font-size": `${EDITOR_FONT_SIZE_PX}px`,
          "--editor-plus-mono": MONOSPACE,
        },
        "&.cm-editor": {
          height: "100%",
          color: colors.foreground,
          backgroundColor: colors.surface0,
        },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily: "var(--editor-plus-mono)",
          fontSize: "var(--editor-plus-font-size)",
          lineHeight: "1.55",
        },
        ".cm-content": { padding: "8px 0", caretColor: colors.foreground },
        ".cm-cursor, .cm-dropCursor": { borderLeftColor: colors.foreground },
        ".cm-gutters": {
          backgroundColor: colors.surface0,
          color: colors.foregroundMuted,
          border: "none",
        },
        // The selection is drawn behind the text, so the current line's background must let it
        // show through.
        ".cm-activeLine": {
          backgroundColor: `color-mix(in srgb, ${colors.foreground} 5%, transparent)`,
        },
        ".cm-activeLineGutter": { backgroundColor: colors.surface1 },
        // As specific as CodeMirror's own rules, which otherwise win with a near-invisible grey.
        // Stronger on dark backgrounds, where a translucent accent barely shows.
        "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, ::selection": {
          backgroundColor: `color-mix(in srgb, ${colors.accent} ${dark ? 60 : 35}%, transparent)`,
        },
        "& > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
          backgroundColor: `color-mix(in srgb, ${colors.accent} ${dark ? 38 : 22}%, transparent)`,
        },
        // Tooltips sit over the code: a raised surface, a firm border, and a shadow set them apart.
        // Outside the app's own elements, tooltips set their fonts rather than inherit the page's.
        ".cm-tooltip": {
          fontFamily: SANS,
          fontSize: "var(--editor-plus-font-size)",
          lineHeight: "1.45",
          backgroundColor: colors.surface2,
          color: colors.foreground,
          border: `1px solid color-mix(in srgb, ${colors.foreground} 22%, ${colors.surface2})`,
          borderRadius: "6px",
          boxShadow: dark ? "0 8px 24px rgba(0, 0, 0, 0.55)" : "0 8px 24px rgba(0, 0, 0, 0.16)",
        },
        // Hover documentation can be long: cap it and let it scroll. CodeMirror also shrinks a
        // tooltip to the space left in the window, which without this cut its content off.
        ".cm-tooltip.cm-tooltip-hover, .cm-tooltip.cm-lsp-signature-tooltip": {
          maxWidth: "min(640px, calc(100vw - 32px))",
          maxHeight: "min(420px, 60vh)",
          overflowY: "auto",
          overscrollBehavior: "contain",
        },
        ".cm-tooltip-hover .cm-tooltip-section:not(:first-child)": {
          borderTop: `1px solid color-mix(in srgb, ${colors.foreground} 18%, ${colors.surface2})`,
        },
        ".cm-lsp-hover-tooltip.cm-lsp-documentation": { padding: "4px 10px" },
        ".cm-lsp-documentation pre": {
          overflowX: "auto",
          padding: "4px 6px",
          borderRadius: "4px",
          backgroundColor: colors.surface1,
        },
        // Documentation links take the browser's default blue otherwise, unreadable when dark.
        ".cm-lsp-documentation h1, .cm-lsp-documentation h2, .cm-lsp-documentation h3": {
          fontSize: "1.1em",
          margin: "8px 0 2px",
        },
        ".cm-lsp-documentation h4, .cm-lsp-documentation h5, .cm-lsp-documentation h6": {
          fontSize: "1em",
          margin: "6px 0 2px",
        },
        ".cm-tooltip a, .cm-tooltip a:visited": { color: c.link, textDecoration: "underline" },
        ".cm-tooltip a:hover": { textDecoration: "none" },
        ".cm-lsp-documentation hr": {
          border: "none",
          borderTop: `1px solid color-mix(in srgb, ${colors.foreground} 18%, ${colors.surface2})`,
        },
        ".cm-tooltip-autocomplete ul li[aria-selected]": {
          backgroundColor: colors.accent,
          color: colors.accentForeground,
        },
        ".cm-panels": { backgroundColor: colors.surface1, color: colors.foreground },
        ".cm-foldPlaceholder": {
          backgroundColor: colors.surface2,
          border: "none",
          color: colors.foregroundMuted,
        },
        // Code in documentation a touch smaller than its prose, as in the editor's own font.
        ".cm-lsp-documentation code, .cm-lsp-documentation pre, .cm-tooltip-autocomplete ul, .cm-lsp-signature":
          { fontFamily: "var(--editor-plus-mono)", fontSize: "0.92em" },
      },
      { dark },
    ),
    syntaxHighlighting(
      highlightStyle(
        c,
        language.tags.map(({ tag, color }) => ({ tag, color: c[color] })),
      ),
    ),
    semanticTheme(c),
  ];
}
