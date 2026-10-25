import { realpathSync, readFileSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { dirname, join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Paseo's plugin compiler (packages/server/src/server/plugins/compiler-imports.ts in 0.13) walks
// every runtime dependency and every declaration it resolves, using this plugin's tsconfig with
// Bundler resolution, and fails the build on a type import it cannot resolve. Ambient
// `declare module` names and outdated paths inside dependencies' declarations trip it; tsconfig
// `paths` maps them. This walk mirrors it, so such a failure shows here instead of on the daemon.

const root = join(__dirname, "..");
const require = createRequire(import.meta.url);

function unresolvedTypeImports(entry: string): string[] {
  const configFile = ts.findConfigFile(root, ts.sys.fileExists)!;
  const config = ts.getParsedCommandLineOfConfigFile(
    configFile,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: () => {},
    },
  )!;
  const options = {
    ...config.options,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
  };
  const seen = new Set<string>();
  const missing = new Set<string>();
  const imports = (file: string): [string, boolean][] => {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const found: [string, boolean][] = [];
    const visit = (node: ts.Node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        const typeOnly = ts.isImportDeclaration(node)
          ? !!node.importClause?.isTypeOnly
          : node.isTypeOnly;
        found.push([node.moduleSpecifier.text, source.isDeclarationFile || typeOnly]);
      } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)
      ) {
        found.push([node.argument.literal.text, true]);
      } else if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require" &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        found.push([node.arguments[0].text, source.isDeclarationFile]);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
  };
  const walk = (file: string) => {
    if (seen.has(file) || !/\.[cm]?[jt]sx?$/.test(file)) return;
    seen.add(file);
    for (const [specifier, typeOnly] of imports(file)) {
      if (
        /^(@getpaseo\/|zod|react|react-native|@tanstack\/react-query)(\/|$)/.test(specifier) ||
        isBuiltin(specifier)
      )
        continue;
      const declaration = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule
        ?.resolvedFileName;
      if (!declaration && typeOnly) missing.add(`${specifier} <- ${relative(root, file)}`);
      if (declaration) walk(realpathSync(declaration));
      if (!typeOnly) {
        try {
          walk(realpathSync(require.resolve(specifier, { paths: [dirname(file)] })));
        } catch {
          // esbuild reports missing runtime modules itself.
        }
      }
    }
  };
  walk(join(root, entry));
  return [...missing];
}

describe("Paseo's plugin build", () => {
  it("maps paths only to files a production install has", () => {
    const tsconfig = ts.readConfigFile(join(root, "tsconfig.json"), ts.sys.readFile).config as {
      compilerOptions: { paths?: Record<string, string[]> };
    };
    const { devDependencies = {} } = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as {
      devDependencies?: Record<string, string>;
    };
    for (const targets of Object.values(tsconfig.compilerOptions.paths ?? {})) {
      for (const target of targets) {
        const name = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(target)?.[1];
        // npm ci --omit=dev on the daemon leaves devDependencies out.
        if (name) expect(devDependencies, target).not.toHaveProperty([name]);
      }
    }
  });

  it("resolves every type import in the server bundle's dependencies", () => {
    expect(unresolvedTypeImports("index.server.ts")).toEqual([]);
  }, 120_000);

  it("resolves every type import in the client bundle's dependencies", () => {
    expect(unresolvedTypeImports("index.client.tsx")).toEqual([]);
  }, 120_000);
});
