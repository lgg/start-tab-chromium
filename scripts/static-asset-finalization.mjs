import { cp, writeFile } from "node:fs/promises";

import { assertSafeBuildOutputFilesystem } from "./build-output-path.mjs";

function requiredFunction(name, value) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
  return value;
}

/**
 * Create a guarded, sequential writer for static build outputs.
 *
 * Every destination operation revalidates the output filesystem immediately
 * before the write. Batches are intentionally sequential: Promise.all rejects
 * before sibling writes settle, which can let a late sibling recreate output
 * after failure cleanup has already run.
 */
export function createStaticOutputWriter({
  root,
  temporaryRoot,
  outdir,
  copy = cp,
  write = writeFile,
  assertOutputSafe = assertSafeBuildOutputFilesystem,
}) {
  const copyFile = requiredFunction("copy", copy);
  const writeFileValue = requiredFunction("write", write);
  const assertSafe = requiredFunction("assertOutputSafe", assertOutputSafe);

  async function guard() {
    await assertSafe(root, temporaryRoot, outdir);
  }

  async function copyOne(from, to, options) {
    await guard();
    await copyFile(from, to, options);
  }

  async function copyBatch(entries) {
    for (const entry of entries) {
      const [from, to, options] = entry;
      await copyOne(from, to, options);
    }
  }

  async function writeOne(target, data, options) {
    await guard();
    await writeFileValue(target, data, options);
  }

  return { copyOne, copyBatch, writeOne };
}
