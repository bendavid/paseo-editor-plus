import type { PluginTheme } from "@getpaseo/plugin";
import { isDark } from "../colors";
import type { DocumentPreviewOptions, DocumentPreviewView } from "../web-contract";

// The Markdown and Marp preview. The daemon renders the HTML (raw HTML off); it goes into a shadow
// root, so the document's styles and Paseo's never meet, after a second pass that drops anything
// executable. Elements carry `data-source-line`, the zero-based line they start on.

const DROP = "script, iframe, object, embed, form, link, meta, base, style";

function sanitize(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll(DROP).forEach((node) => node.remove());
  for (const element of Array.from(template.content.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (
        name.startsWith("on") ||
        ((name === "href" || name === "src") && value.startsWith("javascript:"))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return template.content;
}

function palette(theme: PluginTheme) {
  const dark = isDark(theme);
  return {
    keyword: dark ? "#c792ea" : "#7c3aed",
    string: dark ? "#c3e88d" : "#15803d",
    number: dark ? "#f78c6c" : "#b45309",
    comment: dark ? "#7f848e" : "#6b7280",
    title: dark ? "#82aaff" : "#1d4ed8",
  };
}

function markdownCss(theme: PluginTheme): string {
  const { colors } = theme;
  const c = palette(theme);
  return `
:host { all: initial; display: block; height: 100%; }
.scroll { height: 100%; overflow: auto; box-sizing: border-box; background: ${colors.surface0}; }
.doc { color: ${colors.foreground}; font: 15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
  max-width: 860px; margin: 0 auto; padding: 24px 32px 64px; }
.doc.invert { filter: invert(1) hue-rotate(180deg); }
.doc h1, .doc h2 { border-bottom: 1px solid ${colors.border}; padding-bottom: 0.25em; }
.doc h1, .doc h2, .doc h3, .doc h4 { line-height: 1.25; margin: 1.4em 0 0.6em; }
.doc a { color: ${colors.accent}; }
.doc code { font: 0.9em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: ${colors.surface1}; padding: 0.15em 0.35em; border-radius: 4px; }
.doc pre { background: ${colors.surface1}; padding: 12px 14px; border-radius: 8px; overflow: auto; }
.doc pre code { background: none; padding: 0; }
.doc blockquote { margin: 0; padding: 0 1em; color: ${colors.foregroundMuted}; border-left: 3px solid ${colors.border}; }
.doc table { border-collapse: collapse; }
.doc th, .doc td { border: 1px solid ${colors.border}; padding: 6px 12px; }
.doc img { max-width: 100%; }
.doc hr { border: none; border-top: 1px solid ${colors.border}; }
.doc .hljs-keyword, .doc .hljs-built_in, .doc .hljs-selector-tag { color: ${c.keyword}; }
.doc .hljs-string, .doc .hljs-attr, .doc .hljs-template-variable { color: ${c.string}; }
.doc .hljs-number, .doc .hljs-literal { color: ${c.number}; }
.doc .hljs-comment, .doc .hljs-quote { color: ${c.comment}; font-style: italic; }
.doc .hljs-title, .doc .hljs-function, .doc .hljs-section { color: ${c.title}; }
.slides { padding: 16px; }
.slides.invert { filter: invert(1) hue-rotate(180deg); }
.slides div.marpit > svg { display: block; width: 100%; height: auto; margin: 0 auto 16px;
  max-width: 1100px; box-shadow: 0 2px 10px rgb(0 0 0 / 0.25); }
.flash { outline: 2px solid ${colors.accent}; outline-offset: 2px; border-radius: 2px; }
`;
}

export function mountDocumentPreview(
  parentElement: unknown,
  options: DocumentPreviewOptions,
): DocumentPreviewView {
  const parent = parentElement as HTMLElement;
  const host = document.createElement("div");
  host.style.height = "100%";
  parent.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const baseStyle = document.createElement("style");
  const documentStyle = document.createElement("style");
  const scroll = document.createElement("div");
  scroll.className = "scroll";
  const content = document.createElement("div");
  scroll.appendChild(content);
  shadow.append(baseStyle, documentStyle, scroll);

  let theme = options.theme;
  let invert = options.invert;
  let kind: "markdown" | "marp" = "markdown";
  baseStyle.textContent = markdownCss(theme);

  const applyClasses = () => {
    content.className = `${kind === "marp" ? "slides" : "doc"}${invert ? " invert" : ""}`;
  };
  applyClasses();

  const onClick = (event: MouseEvent) => {
    const target = event.target as Element | null;
    const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (anchor) {
      event.preventDefault();
      const href = anchor.getAttribute("href") ?? "";
      if (href.startsWith("#")) {
        shadow
          .getElementById(decodeURIComponent(href.slice(1)))
          ?.scrollIntoView({ block: "start" });
      } else {
        options.onLink(href);
      }
      return;
    }
    const marked = target?.closest?.("[data-source-line]");
    const line = Number(marked?.getAttribute("data-source-line"));
    if (marked && Number.isFinite(line)) options.onLine(line);
  };
  content.addEventListener("click", onClick);

  return {
    setContent(html, css, nextKind) {
      const top = scroll.scrollTop;
      kind = nextKind;
      applyClasses();
      documentStyle.textContent = css;
      content.replaceChildren(sanitize(html));
      scroll.scrollTop = top;
    },
    scrollToLine(line) {
      let best: Element | null = null;
      let bestLine = -1;
      for (const element of Array.from(content.querySelectorAll("[data-source-line]"))) {
        const at = Number(element.getAttribute("data-source-line"));
        if (at <= line && at >= bestLine) {
          best = element;
          bestLine = at;
        }
      }
      if (!best) return;
      // A Marp slide scrolls as a whole; inside a document, the element itself.
      const target = kind === "marp" ? (best.closest("svg") ?? best) : best;
      target.scrollIntoView({ block: kind === "marp" ? "start" : "center", behavior: "smooth" });
      best.classList.add("flash");
      setTimeout(() => best?.classList.remove("flash"), 900);
    },
    setInvert(next) {
      invert = next;
      applyClasses();
    },
    setTheme(next) {
      theme = next;
      baseStyle.textContent = markdownCss(theme);
    },
    destroy() {
      content.removeEventListener("click", onClick);
      host.remove();
    },
  };
}
