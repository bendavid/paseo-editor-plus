import { rm } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PdfjsAssets } from "../server/pdfjs-assets";
import { fakeComponent } from "./component-fixture";

let folder: string;
let assets: PdfjsAssets;

beforeAll(async () => {
  folder = await fakeComponent();
  assets = new PdfjsAssets(async () => folder);
});

afterAll(() => rm(folder, { recursive: true, force: true }));

describe("PDF.js assets", () => {
  it("serve the runtime from the component, with its version", async () => {
    const pdf = await assets.part("pdf");
    expect(pdf.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pdf.source).toContain("GlobalWorkerOptions");
    expect((await assets.part("worker")).source.length).toBeGreaterThan(100_000);
  });

  it("inline the stylesheet's images", async () => {
    const { source } = await assets.part("css");
    expect(source).toContain("data:image/svg+xml;base64,");
    expect(source).not.toMatch(/url\(["']?images\//);
  });

  it("serve binary data by exact name only", async () => {
    expect((await assets.binary("cMapUrl", "UniJIS-UTF16-H.bcmap")).base64).toBeTruthy();
    expect((await assets.binary("wasmUrl", "openjpeg.wasm")).base64).toBeTruthy();
    expect((await assets.binary("cMapUrl", "../package.json")).base64).toBeNull();
    expect((await assets.binary("standardFontDataUrl", "LICENSE_FOXIT")).base64).toBeNull();
    expect((await assets.binary("wasmUrl", "qcms_bg.wasm")).base64).toBeNull();
  });
});
