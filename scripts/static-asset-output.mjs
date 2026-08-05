import { mkdir } from "node:fs/promises";

import { assertSafeBuildOutputFilesystem } from "./build-output-path.mjs";
import { removePathWithinBoundary } from "./path-safety.mjs";

const COMMON_BUNDLE_OUTPUTS = [
  "service-worker.js",
  "popup.js",
  "blocked.js",
  "options.js",
];

const NEW_TAB_BUNDLE_OUTPUTS = [
  "newtab.js",
];

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

export function bundleOutputPaths(blockerOnly = false) {
  return blockerOnly
    ? [...COMMON_BUNDLE_OUTPUTS]
    : [...COMMON_BUNDLE_OUTPUTS, ...NEW_TAB_BUNDLE_OUTPUTS];
}

export function staticAssetOutputPaths(blockerOnly = false) {
  return blockerOnly
    ? [...COMMON_STATIC_OUTPUTS]
    : [...COMMON_STATIC_OUTPUTS, ...NEW_TAB_STATIC_OUTPUTS];
}

export function generatedOutputPaths(blockerOnly = false) {
  return [
    ...bundleOutputPaths(blockerOnly),
    ...staticAssetOutputPaths(blockerOnly),
  ];
}

async function prepareOutputPaths(root, temporaryRoot, outdir, relativePaths) {
  await assertSafeBuildOutputFilesystem(root, temporaryRoot, outdir);
  await mkdir(outdir, { recursive: true });
  await assertSafeBuildOutputFilesystem(root, temporaryRoot, outdir);

  for (const relativePath of relativePaths) {
    await removePathWithinBoundary(outdir, relativePath);
  }
}

/**
 * Preserve the Round 44 static-only cleanup contract for focused fixtures and
 * callers that intentionally manage JavaScript bundles separately.
 */
export async function prepareStaticAssetOutputs(root, temporaryRoot, outdir, blockerOnly = false) {
  await prepareOutputPaths(root, temporaryRoot, outdir, staticAssetOutputPaths(blockerOnly));
}

/**
 * Invalidate every generated extension artifact before each build attempt.
 * Failed watch rebuilds therefore leave no stale or mixed-version extension
 * behind, while bounded link-aware removal preserves unrelated output files.
 */
export async function prepareGeneratedOutputs(root, temporaryRoot, outdir, blockerOnly = false) {
  await prepareOutputPaths(root, temporaryRoot, outdir, generatedOutputPaths(blockerOnly));
}
