import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { removePathWithinBoundary } from "./path-safety.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedDirectories = [
  "build",
  "build-blocker-only",
  "build-google",
  "build-round24-link",
  "build-round25-link",
];

for (const directory of generatedDirectories) {
  await removePathWithinBoundary(projectRoot, resolve(projectRoot, directory));
}

console.log("Removed generated extension build directories without traversing links");
