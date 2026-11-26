import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { transformSync } from "esbuild";

// Run fixtures against individual source modules rather than tree-shaken
// bundles, so coverage is attributed to the original TypeScript files.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function projectTypeScript(url) {
  if (!url.startsWith("file:")) return false;
  const relative = path.relative(root, fileURLToPath(url));
  return /^(src|scripts)[\\/]/.test(relative) && relative.endsWith(".ts");
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".") || !specifier.endsWith(".js")) throw error;
      const candidate = new URL(specifier.slice(0, -3) + ".ts", context.parentURL).href;
      if (!projectTypeScript(candidate)) throw error;
      return nextResolve(candidate, context);
    }
  },
  load(url, context, nextLoad) {
    if (!projectTypeScript(url)) return nextLoad(url, context);
    const filename = fileURLToPath(url);
    const source = readFileSync(filename, "utf8");
    const transformed = transformSync(source, {
      loader: "ts",
      format: "esm",
      target: "node22",
      sourcefile: pathToFileURL(filename).href,
      sourcemap: "inline",
      sourcesContent: true,
      tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
    });
    return { format: "module", source: transformed.code, shortCircuit: true };
  },
});
