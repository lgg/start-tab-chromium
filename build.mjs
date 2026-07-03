// Build script: bundles the TypeScript entry points with esbuild and copies
// the static assets into a flat build dir that can be loaded unpacked in
// Chrome or zipped for the Web Store.

import * as esbuild from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");
const withoutNewTab = process.argv.includes("--without-newtab");
const outdirFlag = process.argv.find((arg) => arg.startsWith("--outdir="));
const outdir = resolve(root, outdirFlag?.slice("--outdir=".length) || "build");

const entryPoints = {
  "service-worker": "src/service-worker.ts",
  popup: "src/popup/popup.ts",
  blocked: "src/blocked/blocked.ts",
  newtab: "src/newtab/newtab.ts",
  "newtab-onboarding": "src/newtab/onboarding.ts",
  options: "src/options/options.ts",
};

/** Static files copied verbatim: [from, to] relative to root/outdir. */
const staticAssets = [
  ["src/_locales", "_locales"],
  ["src/popup/popup.html", "popup.html"],
  ["src/popup/popup.css", "popup.css"],
  ["src/blocked/blocked.html", "blocked.html"],
  ["src/blocked/blocked.css", "blocked.css"],
  ["src/newtab/newtab.html", "newtab.html"],
  ["src/newtab/newtab.css", "newtab.css"],
  ["src/newtab/instances.css", "newtab-instances.css"],
  ["src/newtab/newtab-gate.js", "newtab-gate.js"],
  ["src/newtab/editor.js", "newtab-editor.js"],
  ["src/newtab/ip.js", "newtab-ip.js"],
  ["src/newtab/instances.js", "newtab-instances.js"],
  ["src/options/options.html", "options.html"],
  ["src/options/options.css", "options.css"],
  ["src/options/options-helper.js", "options-helper.js"],
  ["src/options/background-presets.js", "background-presets.js"],
  ["icons", "icons"],
];

async function copyManifest() {
  const manifestPath = resolve(root, "src/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (withoutNewTab) delete manifest.chrome_url_overrides;
  await writeFile(resolve(outdir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function copyStatic() {
  await Promise.all(
    staticAssets.map(([from, to]) =>
      cp(resolve(root, from), resolve(outdir, to), { recursive: true }),
    ),
  );
  await copyManifest();
}

const copyStaticPlugin = {
  name: "copy-static",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length === 0) {
        await copyStatic();
        console.log(`Built extension -> ${outdir}`);
      }
    });
  },
};

const options = {
  entryPoints,
  outdir,
  bundle: true,
  format: "esm",
  target: "chrome120",
  platform: "browser",
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  logLevel: "info",
  plugins: [copyStaticPlugin],
};

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(options);
}
