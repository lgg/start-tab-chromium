import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertSafeBuildOutputFilesystem } from "./build-output-path.mjs";

function requiredFunction(name, value) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
  return value;
}

function optionalFunction(name, value, fallback) {
  if (value === undefined) return fallback;
  return requiredFunction(name, value);
}

function resolveOutputTarget(outdir, requested) {
  const root = path.resolve(outdir);
  const candidate = path.resolve(requested);
  const relative = path.relative(root, candidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Build output target must stay strictly inside the selected outdir: ${candidate}`);
  }
  return candidate;
}

/**
 * Create a guarded, sequential writer for generated build outputs.
 *
 * Static copies can optionally revalidate their concrete source immediately
 * before use. Every destination operation revalidates the output filesystem
 * immediately before the write. Batches are intentionally sequential:
 * Promise.all rejects before sibling writes settle, which can let a late
 * sibling recreate output after failure cleanup has already run.
 */
export function createStaticOutputWriter({
  root,
  temporaryRoot,
  outdir,
  copy = cp,
  read = readFile,
  write = writeFile,
  assertOutputSafe = assertSafeBuildOutputFilesystem,
  assertSourceSafe,
}) {
  const copyFile = requiredFunction("copy", copy);
  const readFileValue = requiredFunction("read", read);
  const writeFileValue = requiredFunction("write", write);
  const assertSafe = requiredFunction("assertOutputSafe", assertOutputSafe);
  const assertSource = optionalFunction("assertSourceSafe", assertSourceSafe, async () => {});
  const resolvedOutdir = path.resolve(outdir);

  async function guard() {
    await assertSafe(root, temporaryRoot, resolvedOutdir);
  }

  async function copyOne(from, to, options) {
    const destination = resolveOutputTarget(resolvedOutdir, to);
    await assertSource(from, options);
    await guard();
    await copyFile(from, destination, options);
  }

  async function copyBatch(entries) {
    for (const entry of entries) {
      const [from, to, options] = entry;
      await copyOne(from, to, options);
    }
  }

  async function readOne(source, options) {
    await assertSource(source, { recursive: false });
    return readFileValue(source, options);
  }

  async function writeOne(target, data, options) {
    const destination = resolveOutputTarget(resolvedOutdir, target);
    await guard();
    await writeFileValue(destination, data, options);
  }

  async function writeOutputFiles(outputFiles, expectedRelativePaths) {
    if (!Array.isArray(outputFiles)) {
      throw new TypeError("esbuild outputFiles must be an array; configure the build with write: false");
    }
    if (!Array.isArray(expectedRelativePaths)) {
      throw new TypeError("expectedRelativePaths must be an array");
    }

    const expected = new Map();
    for (const relativePath of expectedRelativePaths) {
      const target = resolveOutputTarget(resolvedOutdir, path.join(resolvedOutdir, relativePath));
      const key = process.platform === "win32" ? target.toLowerCase() : target;
      if (expected.has(key)) throw new Error(`Duplicate expected build output: ${relativePath}`);
      expected.set(key, { relativePath, target });
    }

    const actual = new Map();
    for (const outputFile of outputFiles) {
      if (!outputFile || typeof outputFile.path !== "string" || !("contents" in outputFile)) {
        throw new TypeError("Every esbuild output file must contain path and contents");
      }
      const target = resolveOutputTarget(resolvedOutdir, outputFile.path);
      const key = process.platform === "win32" ? target.toLowerCase() : target;
      if (actual.has(key)) throw new Error(`Duplicate esbuild output file: ${outputFile.path}`);
      actual.set(key, { target, contents: outputFile.contents });
    }

    const missing = [...expected.entries()]
      .filter(([key]) => !actual.has(key))
      .map(([, value]) => value.relativePath);
    const unexpected = [...actual.entries()]
      .filter(([key]) => !expected.has(key))
      .map(([, value]) => path.relative(resolvedOutdir, value.target));
    if (missing.length > 0 || unexpected.length > 0) {
      throw new Error(
        `Unexpected esbuild output set; missing=[${missing.join(", ")}], unexpected=[${unexpected.join(", ")}]`,
      );
    }

    for (const { target } of expected.values()) {
      const key = process.platform === "win32" ? target.toLowerCase() : target;
      const outputFile = actual.get(key);
      await writeOne(target, outputFile.contents);
    }
  }

  return { copyOne, copyBatch, readOne, writeOne, writeOutputFiles };
}
