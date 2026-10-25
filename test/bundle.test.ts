import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// Mirrors the client options in Paseo's plugin compiler (packages/server/src/server/plugins/compiler.ts).
const HOST_MODULES = [
  "@getpaseo/plugin",
  "@getpaseo/plugin/client",
  "@getpaseo/plugin/client/ui",
  "@tanstack/react-query",
  "react",
  "react/jsx-runtime",
  "react-native",
  "zod",
];

async function compileClient(): Promise<string> {
  const result = await build({
    entryPoints: ["index.client.tsx"],
    bundle: true,
    format: "cjs",
    jsx: "automatic",
    platform: "neutral",
    target: "es2020",
    mainFields: ["module", "main"],
    supported: { "async-await": false },
    external: HOST_MODULES,
    logLevel: "silent",
    write: false,
  });
  return result.outputFiles[0].text;
}

describe("client bundle", () => {
  it("contains no import() syntax, which stops Hermes from parsing it on iOS and Android", async () => {
    expect(await compileClient()).not.toMatch(/\bimport\s*\(/);
  });

  it("evaluates without a DOM, as the native apps do, and registers the panel", async () => {
    const bundle = await compileClient();
    expect(bundle.length).toBeLessThan(1_500_000);
    // Host modules are stand-ins; any property is a no-op function.
    const stub: object = new Proxy(() => stub, { get: () => stub, apply: () => stub });
    const module = { exports: {} as { default?: (client: unknown) => unknown } };
    const sandbox = { module, exports: module.exports, require: () => stub, console };
    runInNewContext(bundle, sandbox);
    const registered: string[] = [];
    const client = {
      openSettings: () => {},
      addSettingsScreen: (screen: { id: string }) => (
        registered.push(`settings:${screen.id}`),
        () => {}
      ),
      addFilePanel: (panel: { id: string; files: { extensions: string[] } }) => (
        registered.push(`panel:${panel.id}:${panel.files.extensions.join(",")}`),
        () => {}
      ),
    };
    module.exports.default?.(client);
    expect(registered).toEqual(["settings:servers", "panel:typst:typ"]);
  });
});
