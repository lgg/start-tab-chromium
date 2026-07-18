import * as esbuild from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertSafeBuildOutputFilesystem, resolveSafeBuildOutput } from "./build-output-path.mjs";
import { requireGoogleOAuthClientId } from "./google-oauth-client.mjs";

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
  await writeFile(output("manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
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

const copyPlugin = {
  name: "copy-extension-static-assets",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length === 0) {
        assertProductionGraph(result.metafile);
        await copyStaticAssets();
        const profile = googleEnabled ? "Google-enabled full" : blockerOnly ? "blocker-only" : "full";
        console.log(`Built ${profile} extension at ${outdir}`);
      }
    });
  },
};

await assertSafeBuildOutputFilesystem(root, tmpdir(), outdir);
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
  metafile: true,
  plugins: [copyPlugin],
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
  const profile = googleEnabled ? "Google-enabled full" : blockerOnly ? "blocker-only" : "full";
  console.log(`Watching ${profile} extension sources...`);
} else {
  await esbuild.build(options);
}
