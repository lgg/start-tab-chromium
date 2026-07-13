import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const blockerOnly = process.argv.includes("--blocker-only");
const outdir = path.join(root, blockerOnly ? "dist-blocker-only" : "dist");
const source = (...parts) => path.join(root, "src", ...parts);
const output = (...parts) => path.join(outdir, ...parts);

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const entryPoints = {
  "service-worker": source("service-worker.ts"),
  popup: source("popup", "popup.ts"),
  blocked: source("blocked", "blocked.ts"),
  options: source("options", "options.ts"),
};
if (!blockerOnly) entryPoints.newtab = source("newtab", "newtab.ts");

await build({
  entryPoints,
  outdir,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome114"],
  sourcemap: false,
  minify: false,
  legalComments: "none",
  logLevel: "info",
});

const commonFiles = [
  [source("popup", "popup.html"), output("popup.html")],
  [source("popup", "popup.css"), output("popup.css")],
  [source("blocked", "blocked.html"), output("blocked.html")],
  [source("blocked", "blocked.css"), output("blocked.css")],
  [source("options", "options.html"), output("options.html")],
  [source("options", "options.css"), output("options.css")],
  [source("shared-ui.css"), output("shared-ui.css")],
];
for (const [from, to] of commonFiles) await cp(from, to);

if (!blockerOnly) {
  await cp(source("newtab", "newtab.html"), output("newtab.html"));
  await cp(source("newtab", "newtab.css"), output("newtab.css"));
  await cp(source("newtab", "newtab-gate.js"), output("newtab-gate.js"));
}

await cp(source("icons"), output("icons"), { recursive: true });
await cp(source("_locales"), output("_locales"), { recursive: true });

const manifest = JSON.parse(await readFile(source("manifest.json"), "utf8"));
if (blockerOnly) {
  delete manifest.chrome_url_overrides;
}
await writeFile(output("manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Built ${blockerOnly ? "blocker-only" : "full"} extension at ${outdir}`);
