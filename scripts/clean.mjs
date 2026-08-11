import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { removePathWithinBoundary } from "./path-safety.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedPaths = [
  "build",
  "build-blocker-only",
  "build-google",
  "build-round24-link",
  "build-round25-link",
  "locale-parity-report.json",
];

for (const generatedPath of generatedPaths) {
  await removePathWithinBoundary(projectRoot, resolve(projectRoot, generatedPath));
}

console.log("Removed generated extension outputs and locale report without traversing links");
