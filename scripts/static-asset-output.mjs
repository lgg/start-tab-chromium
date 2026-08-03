import { mkdir } from "node:fs/promises";

import { assertSafeBuildOutputFilesystem } from "./build-output-path.mjs";
import { removePathWithinBoundary } from "./path-safety.mjs";

const COMMON_STATIC_OUTPUTS = [
  "popup.html",
  "popup.css",
  "blocked.html",
  "blocked.css",
  "options.html",
  "options.css",
  "shared-ui.css",
  "icons",
  "_locales",
  "manifest.json",
];

const NEW_TAB_STATIC_OUTPUTS = [
  "newtab.html",
  "newtab.css",
  "newtab-gate.js",
];

export function staticAssetOutputPaths(blockerOnly = false) {
  return blockerOnly
    ? [...COMMON_STATIC_OUTPUTS]
    : [...COMMON_STATIC_OUTPUTS, ...NEW_TAB_STATIC_OUTPUTS];
}

/**
 * Revalidate a long-running build output before every static copy and remove
 * each generated static target without following final links. This prevents a
 * failed copy from leaving a stale file behind and prevents watch mode from
 * writing through a link that appeared after startup validation.
 */
export async function prepareStaticAssetOutputs(root, temporaryRoot, outdir, blockerOnly = false) {
  await assertSafeBuildOutputFilesystem(root, temporaryRoot, outdir);
  await mkdir(outdir, { recursive: true });
  await assertSafeBuildOutputFilesystem(root, temporaryRoot, outdir);

  for (const relativePath of staticAssetOutputPaths(blockerOnly)) {
    await removePathWithinBoundary(outdir, relativePath);
  }
}
