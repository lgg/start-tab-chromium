import * as esbuild from "esbuild";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createBuildOutputLifecyclePlugin } from "./build-output-lifecycle.mjs";
import { assertSafeBuildOutputFilesystem, resolveSafeBuildOutput } from "./build-output-path.mjs";
import { requireGoogleOAuthClientId } from "./google-oauth-client.mjs";
import { createStaticOutputWriter } from "./static-asset-finalization.mjs";
import { bundleOutputPaths } from "./static-asset-output.mjs";
import {
  STATIC_ASSET_WATCH_IMPORT,
  assertValidStaticAssetTrees,
  assertValidStaticCopySource,
  createStaticAssetWatchPlugin,
} from "./static-asset-watch.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");
const blockerOnly = process.argv.includes("--blocker-only") || process.argv.includes("--without-newtab");
const googleEnabled = process.argv.includes("--google");
if (googleEnabled && blockerOnly) {
  throw new Error("The explicit Google build profile cannot be combined with blocker-only mode");
}
const googleOAuthClientId = googleEnabled ? requireGoogleOAuthClientId() : "";
const outdirFlag = process.argv.find((argument) => argument.startsWith("--outdir="));
const requestedOutdir = outdirFlag?.slice("--outdir=".length)
  || (blockerOnly ? "build-blocker-only" : googleEnabled ? "build-google" : "build");
const outdir = resolveSafeBuildOutput(root, tmpdir(), requestedOutdir);
const source = (...parts) => path.join(root, "src", ...parts);
const output = (...parts) => path.join(outdir, ...parts);
const profile = googleEnabled ? "Google-enabled full" : blockerOnly ? "blocker-only" : "full";
const staticOutputWriter = createStaticOutputWriter({
  root,
  temporaryRoot: tmpdir(),
  outdir,
  assertSourceSafe: assertValidStaticCopySource,
});

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

async function validateFinalizationInputs() {
  await assertValidStaticAssetTrees(root, blockerOnly);
}

async function writeBundleOutputs(outputFiles) {
  await staticOutputWriter.writeOutputFiles(outputFiles, bundleOutputPaths(blockerOnly));
}

async function copyStaticAssets() {
  // Validate every static input before the first static output write. The
  // lifecycle already performs the same whole-tree preflight before bundle
  // finalization, and the writer additionally revalidates each concrete source
  // immediately before its cp/read operation.
  await assertValidStaticAssetTrees(root, blockerOnly);

  // Static writes are intentionally serialized. A failing Promise.all sibling
  // can otherwise reject early while another cp() keeps writing and recreates
  // generated output after lifecycle cleanup has already completed.
  await staticOutputWriter.copyBatch(commonFiles);
  if (!blockerOnly) {
    await staticOutputWriter.copyBatch([
      [source("newtab", "newtab.html"), output("newtab.html")],
      [source("newtab", "newtab.css"), output("newtab.css")],
      [source("newtab", "newtab-gate.js"), output("newtab-gate.js")],
    ]);
  }
  await staticOutputWriter.copyBatch([
    [path.join(root, "icons"), output("icons"), { recursive: true }],
    [source("_locales"), output("_locales"), { recursive: true }],
  ]);

  const manifest = JSON.parse(await staticOutputWriter.readOne(source("manifest.json"), "utf8"));
  if (blockerOnly) {
    delete manifest.chrome_url_overrides;
    manifest.permissions = (manifest.permissions ?? []).filter((permission) => permission !== "history");
  }
  if (googleEnabled) {
    manifest.oauth2 = { ...manifest.oauth2, client_id: googleOAuthClientId };
  } else {
    delete manifest.oauth2;
    manifest.permissions = (manifest.permissions ?? []).filter((permission) => permission !== "identity");
  }
  await staticOutputWriter.writeOne(output("manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

const forbiddenProductionInputs = [
  "src/lib/start-page-block-store.ts",
  "src/lib/start-page-theme-store.ts",
  "src/lib/start-page-settings-store.ts",
  "src/lib/start-page-validation-v2.ts",
  "src/lib/start-page-reset.ts",
  "src/lib/start-page-runtime-clock.ts",
  "src/lib/start-page-settings-themes.ts",
  "src/newtab/block-renderers.js",
  "src/newtab/block-renderers-v2.ts",
  "src/newtab/block-renderers-runtime-v2.js",
  "src/newtab/block-renderers-runtime-v2.ts",
  "src/newtab/block-renderers-runtime-v3.ts",
];

function assertProductionGraph(metafile) {
  const inputs = Object.keys(metafile?.inputs ?? {}).map((input) => input.replaceAll("\\", "/"));
  for (const forbidden of forbiddenProductionInputs) {
    if (inputs.some((input) => input.endsWith(forbidden))) {
      throw new Error(`Obsolete source entered the production graph: ${forbidden}`);
    }
  }
}

const outputLifecyclePlugin = createBuildOutputLifecyclePlugin({
  root,
  temporaryRoot: tmpdir(),
  outdir,
  blockerOnly,
  assertProductionGraph,
  validateFinalizationInputs,
  writeBundleOutputs,
  copyStaticAssets,
  profile,
});

await assertSafeBuildOutputFilesystem(root, tmpdir(), outdir);

const plugins = [outputLifecyclePlugin];
if (watch) plugins.unshift(createStaticAssetWatchPlugin(root, blockerOnly));

const options = {
  entryPoints,
  outdir,
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: ["chrome120"],
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  legalComments: "none",
  logLevel: "info",
  metafile: true,
  plugins,
  ...(watch ? { inject: [STATIC_ASSET_WATCH_IMPORT] } : {}),
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
  console.log(`Watching ${profile} extension sources and static assets...`);
} else {
  await esbuild.build(options);
}
