import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { BinaryKind, RuntimePart } from "../shared/rpc";

// The PDF.js files the app loads for the LaTeX preview, read from the pdfjs component
// (server/components.ts) and kept in memory once read. The app has no URLs for them, so the
// stylesheet's images are inlined and the worker's binary data travels through plugin calls.

const RUNTIME_FILES: Readonly<Record<RuntimePart, string>> = {
  pdf: "build/pdf.min.mjs",
  viewer: "web/pdf_viewer.mjs",
  worker: "build/pdf.worker.min.mjs",
  css: "web/pdf_viewer.css",
};

/** Folders of PDF.js's binary data, by BinaryDataFactory `kind`, and which files it may ask for. */
const BINARY_FOLDERS: Readonly<
  Record<BinaryKind, { folder: string; serve(name: string): boolean }>
> = {
  cMapUrl: { folder: "cmaps", serve: (name) => name.endsWith(".bcmap") },
  standardFontDataUrl: { folder: "standard_fonts", serve: (name) => !name.startsWith("LICENSE") },
  // Image decoders only: the scripting sandbox is not enabled, and the ICC module is used only
  // when the worker fetches files itself.
  wasmUrl: { folder: "wasm", serve: (name) => name === "jbig2.wasm" || name === "openjpeg.wasm" },
};

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".png": "image/png",
};

export class PdfjsAssets {
  private readonly parts = new Map<RuntimePart, string>();
  private readonly listings = new Map<BinaryKind, Promise<Set<string>>>();

  /** `component` gives the installed component folder, whose node_modules holds pdfjs-dist. */
  constructor(private readonly component: () => Promise<string>) {}

  private async root(): Promise<string> {
    return join(await this.component(), "node_modules", "pdfjs-dist");
  }

  async part(part: RuntimePart): Promise<{ version: string; source: string }> {
    const root = await this.root();
    const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      version: string;
    };
    let source = this.parts.get(part);
    if (source === undefined) {
      source = await readFile(join(root, RUNTIME_FILES[part]), "utf8");
      if (part === "css") source = await inlineImages(source, join(root, "web", "images"));
      this.parts.set(part, source);
    }
    return { version, source };
  }

  /** A binary file by exact name; anything not listed in its folder is missing. */
  async binary(kind: BinaryKind, filename: string): Promise<{ base64: string | null }> {
    const names = await this.listing(kind);
    if (!names.has(filename)) return { base64: null };
    const data = await readFile(join(await this.root(), BINARY_FOLDERS[kind].folder, filename));
    return { base64: data.toString("base64") };
  }

  private listing(kind: BinaryKind): Promise<Set<string>> {
    let listing = this.listings.get(kind);
    if (!listing) {
      const { folder, serve } = BINARY_FOLDERS[kind];
      listing = this.root()
        .then((root) => readdir(join(root, folder)))
        .then((names) => new Set(names.filter(serve)));
      listing.catch(() => this.listings.delete(kind));
      this.listings.set(kind, listing);
    }
    return listing;
  }
}

/** The stylesheet refers to images/…; inline them as data URLs. */
async function inlineImages(css: string, imagesFolder: string): Promise<string> {
  const names = new Set(await readdir(imagesFolder).catch(() => []));
  const pattern = /url\((["']?)images\/([^"')]+)\1\)/g;
  const replacements = new Map<string, string>();
  for (const [, , name] of css.matchAll(pattern)) {
    const type = IMAGE_TYPES[extname(name)];
    if (!type || !names.has(name) || replacements.has(name)) continue;
    const data = await readFile(join(imagesFolder, name));
    replacements.set(name, `url("data:${type};base64,${data.toString("base64")}")`);
  }
  return css.replace(pattern, (match, _quote, name: string) => replacements.get(name) ?? match);
}
