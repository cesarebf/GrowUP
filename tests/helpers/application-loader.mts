// Load the actual App Router/TSX modules under node:test without a new test
// framework or changing production imports. Stub only framework boundaries.
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = new URL("../../", import.meta.url);
type TestGlobal = typeof globalThis & { growupTestModules?: Record<string, Record<string, unknown>> };

export function applicationLoader(stubs: Record<string, Record<string, unknown>>, clientReact = false) {
  (globalThis as TestGlobal).growupTestModules = stubs;
  const clientPaths: Record<string, string> = {
    react: "node_modules/react/index.js",
    "react/jsx-runtime": "node_modules/react/jsx-runtime.js",
    "react-dom": "node_modules/react-dom/index.js",
    "react-dom/server": "node_modules/react-dom/server.node.js",
  };
  return registerHooks({
    resolve(specifier, context, next) {
      if (Object.hasOwn(stubs, specifier)) return { url: `growup-test:${specifier}`, shortCircuit: true };
      if (clientReact && clientPaths[specifier]) return { url: new URL(clientPaths[specifier], root).href, shortCircuit: true };
      if (specifier.startsWith("@/")) {
        const base = new URL(`src/${specifier.slice(2)}`, root);
        for (const suffix of ["", ".ts", ".tsx"]) {
          const url = base.href + suffix;
          if (existsSync(fileURLToPath(url))) return { url, shortCircuit: true };
        }
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url.startsWith("growup-test:")) {
        const specifier = url.slice("growup-test:".length);
        const exports = Object.keys(stubs[specifier]).map((key) => key === "default"
          ? `export default values.default;` : `export const ${key} = values[${JSON.stringify(key)}];`).join("\n");
        return { format: "module", shortCircuit: true, source: `const values = globalThis.growupTestModules[${JSON.stringify(specifier)}];\n${exports}` };
      }
      if (url.startsWith(new URL("src/", root).href) && /\.tsx?$/.test(url)) {
        return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
          fileName: fileURLToPath(url), compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
        }).outputText };
      }
      return next(url, context);
    },
  });
}
