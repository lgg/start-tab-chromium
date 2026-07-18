import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedDirectories = ["build", "build-blocker-only", "build-google"];

for (const directory of generatedDirectories) {
  await rm(resolve(projectRoot, directory), { recursive: true, force: true });
}

console.log("Removed generated extension build directories");
