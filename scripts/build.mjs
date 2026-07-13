import * as esbuild from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");
const blockerOnly = process.argv.includes("--blocker-only") || process.argv.includes("--without-newtab");
const outdirFlag = process.argv.find((argument) => argument.startsWith("--outdir="));
const outdir = path.resolve(
  root,
  outdirFlag?.slice("--outdir=".length) || (blockerOnly ? "build-blocker-only" : "build"),
);
const source = (...parts) => path.join(root, "src", ...parts);
const output = (...parts) => path.join(outdir, ...parts);

const entryPoints = {
  "service-worker": source("service-worker.ts"),
  popup: source("popup", "popup.ts"),
  blocked: source("blocked", "blocked.ts"),
  options: source("options", "options.ts"),
};
if (!blockerOnly) entryPoints.newtab = source("newtab", "newtab.ts");

const commonFiles = [
  [source("popup", "popup.html"), output("popup.html")],
  [source("popup", "popup.css"), output("popup.css")],
  [source("blocked", "blocked.html"), output("blocked.html")],
  [source("blocked", "blocked.css"), output("blocked.css")],
  [source("options", "options.html"), output("options.html")],
  [source("options", "options.css"), output("options.css")],
  [source("shared-ui.css"), output("shared-ui.css")],
];

async function copyStaticAssets() {
  await Promise.all(commonFiles.map(([from, to]) => cp(from, to)));
  if (!blockerOnly) {
    await Promise.all([
      cp(source("newtab", "newtab.html"), output("newtab.html")),
      cp(source("newtab", "newtab.css"), output("newtab.css")),
      cp(source("newtab", "newtab-gate.js"), output("newtab-gate.js")),
    ]);
  }
  await Promise.all([
    cp(path.join(root, "icons"), output("icons"), { recursive: true }),
    cp(source("_locales"), output("_locales"), { recursive: true }),
  ]);

  const manifest = JSON.parse(await readFile(source("manifest.json"), "utf8"));
  if (blockerOnly) delete manifest.chrome_url_overrides;
  await writeFile(output("manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

const copyPlugin = {
  name: "copy-extension-static-assets",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length === 0) {
        await copyStaticAssets();
        console.log(`Built ${blockerOnly ? "blocker-only" : "full"} extension at ${outdir}`);
      }
    });
  },
};

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const options = {
  entryPoints,
  outdir,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome120"],
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  legalComments: "none",
  logLevel: "info",
  plugins: [copyPlugin],
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
  console.log(`Watching ${blockerOnly ? "blocker-only" : "full"} extension sources...`);
} else {
  await esbuild.build(options);
}
