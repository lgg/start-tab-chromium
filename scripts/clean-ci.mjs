import path from "node:path";

import { removePathWithinBoundary, resolveStrictDescendant } from "./path-safety.mjs";

function requiredEnvironment(name) {
  const value = process.env[name]?.trim() ?? "";
  if (!value) throw new Error(`${name} is empty`);
  return value;
}

const workspace = path.resolve(requiredEnvironment("GITHUB_WORKSPACE"));
const runnerTemp = path.resolve(requiredEnvironment("RUNNER_TEMP"));
const configuredCacheRoot = path.resolve(requiredEnvironment("CI_CACHE_ROOT"));
const expectedCacheRoot = path.resolve(runnerTemp, "start-tab-chromium-cache");

if (process.platform === "win32"
  ? configuredCacheRoot.toLowerCase() !== expectedCacheRoot.toLowerCase()
  : configuredCacheRoot !== expectedCacheRoot) {
  throw new Error(`CI_CACHE_ROOT does not match the dedicated runner-temp cache path: ${configuredCacheRoot}`);
}

resolveStrictDescendant(runnerTemp, configuredCacheRoot);

const workspaceTargets = [
  "node_modules",
  "build",
  "build-blocker-only",
  "build-google",
  "build-round24-link",
  "build-round25-link",
  "locale-parity-report.json",
];

for (const relativePath of workspaceTargets) {
  await removePathWithinBoundary(workspace, path.join(workspace, relativePath));
}
await removePathWithinBoundary(runnerTemp, configuredCacheRoot);

console.log("Removed CI workspace outputs and the isolated npm cache without traversing links");
