import { readFile, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { Marp } from "@marp-team/marp-core";
import MarkdownIt from "markdown-it";

// Renders Markdown for the preview on the daemon host: markdown-it, or Marp for a slide deck
// (front matter with `marp: true`). Rendering here keeps markdown-it, Marp, MathJax, and
// highlight.js out of the app's bundle. Raw HTML stays off, so a file cannot put scripts or
// styles into the preview. Block elements carry `data-source-line`, the zero-based line they start
// on, which the preview uses to scroll with the editor and to jump back to the source.

export type MarkdownKind = "markdown" | "marp";

/** Images bigger than this stay as links rather than being inlined. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};

/** `marp: true` in YAML front matter at the top of the file. */
export function isMarp(text: string): boolean {
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  return front !== null && /^marp\s*:\s*true\s*$/m.test(front[1]);
}

interface BlockToken {
  block: boolean;
  map: [number, number] | null;
  nesting: number;
  attrSet(name: string, value: string): void;
}

/** The part of markdown-it a plugin uses; Marp's renderer is markdown-it too. */
interface MarkdownPluginHost {
  core: { ruler: { push(name: string, rule: (state: { tokens: BlockToken[] }) => void): void } };
}

function sourceLines(md: MarkdownPluginHost): void {
  md.core.ruler.push("editor_plus_source_lines", (state) => {
    for (const token of state.tokens) {
      if (token.block && token.map && token.nesting !== -1) {
        token.attrSet("data-source-line", String(token.map[0]));
      }
    }
  });
}

/**
 * Code blocks use Marp's highlight.js. Importing highlight.js here would pull its type
 * declarations into Paseo's plugin build, which cannot resolve them.
 */
function highlight(code: string, language: string): string {
  if (!language) return "";
  try {
    return marpRenderer().highlighter(code, language, "");
  } catch {
    return "";
  }
}

let markdown: InstanceType<typeof MarkdownIt> | null = null;
let marp: Marp | null = null;

function markdownRenderer(): InstanceType<typeof MarkdownIt> {
  if (!markdown) {
    markdown = new MarkdownIt({ html: false, linkify: true, highlight });
    sourceLines(markdown as unknown as MarkdownPluginHost);
  }
  return markdown;
}

function marpRenderer(): Marp {
  if (!marp) {
    // MathJax renders math as SVG, so the slides need no web fonts; no script is added.
    marp = new Marp({ html: false, inlineSVG: true, math: "mathjax", script: false });
    marp.use((md: unknown) => sourceLines(md as MarkdownPluginHost));
  }
  return marp;
}

const decodeAttribute = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** The local image a `src` or `url()` refers to, as a data: URL; null when it is not one. */
async function inlineImage(reference: string, folder: string): Promise<string | null> {
  const target = decodeAttribute(reference).trim();
  if (
    !target ||
    /^[a-z][a-z0-9+.-]*:/i.test(target) ||
    target.startsWith("//") ||
    target.startsWith("#")
  ) {
    return null;
  }
  let path: string;
  try {
    path = decodeURIComponent(target.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  path = isAbsolute(path) ? path : resolve(folder, path);
  const type = IMAGE_TYPES[extname(path).toLowerCase()];
  if (!type) return null;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_IMAGE_BYTES) return null;
    return `data:${type};base64,${(await readFile(path)).toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * The app has no URL for files on the daemon host, so local images, including Marp background
 * images, are inlined.
 */
async function inlineLocalImages(html: string, folder: string): Promise<string> {
  const pattern = /(src=")([^"]*)(")|(url\((?:&quot;|"|')?)([^)"&']*)((?:&quot;|"|')?\))/g;
  const references = new Set<string>();
  for (const match of html.matchAll(pattern)) references.add(match[2] ?? match[5]);
  const inlined = new Map<string, string>();
  for (const reference of references) {
    const data = await inlineImage(reference, folder);
    if (data) inlined.set(reference, data);
  }
  if (inlined.size === 0) return html;
  return html.replace(pattern, (whole, srcOpen, src, srcClose, urlOpen, url, urlClose) => {
    const reference = src ?? url;
    const data = inlined.get(reference);
    if (!data) return whole;
    return src !== undefined ? `${srcOpen}${data}${srcClose}` : `${urlOpen}${data}${urlClose}`;
  });
}

export async function renderMarkdown(
  file: string,
  text: string,
): Promise<{ kind: MarkdownKind; html: string; css: string }> {
  const folder = dirname(file);
  if (isMarp(text)) {
    const { html, css } = marpRenderer().render(text);
    return { kind: "marp", html: await inlineLocalImages(html, folder), css };
  }
  const html = markdownRenderer().render(text);
  return { kind: "markdown", html: await inlineLocalImages(html, folder), css: "" };
}
