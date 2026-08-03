import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  prepareStaticAssetOutputs,
  staticAssetOutputPaths,
} from "./static-asset-output.mjs";

const temporary = await mkdtemp(path.join(tmpdir(), "start-tab-round44-"));
const root = path.join(temporary, "project");
const outdir = path.join(root, "build-round44");
const protectedDirectory = path.join(temporary, "protected");

async function absent(target) {
  try {
    await lstat(target);
    return false;
  } catch (error) {
    return Boolean(error) && typeof error === "object" && "code" in error && error.code === "ENOENT";
  }
}

async function createOutput(relativePath, content = relativePath) {
  const target = path.join(outdir, relativePath);
  if (relativePath === "icons" || relativePath === "_locales") {
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "stale.txt"), content, "utf8");
  } else {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return target;
}

try {
  await mkdir(protectedDirectory, { recursive: true });
  await writeFile(path.join(protectedDirectory, "sentinel.txt"), "external data must survive", "utf8");

  for (const relativePath of staticAssetOutputPaths(false)) await createOutput(relativePath);
  const linkedOutput = path.join(outdir, "popup.html");
  await rm(linkedOutput, { recursive: true, force: true });
  await symlink(protectedDirectory, linkedOutput, process.platform === "win32" ? "junction" : "dir");

  await prepareStaticAssetOutputs(root, tmpdir(), outdir, false);
  for (const relativePath of staticAssetOutputPaths(false)) {
    assert.equal(await absent(path.join(outdir, relativePath)), true,
      `Full static preparation must remove stale output: ${relativePath}`);
  }
  assert.equal(await absent(outdir), false, "Static preparation must preserve the output directory itself");
  assert.equal(await readFile(path.join(protectedDirectory, "sentinel.txt"), "utf8"), "external data must survive",
    "A final output junction must be removed without traversing its external target");

  for (const relativePath of staticAssetOutputPaths(false)) await createOutput(relativePath);
  await prepareStaticAssetOutputs(root, tmpdir(), outdir, true);
  for (const relativePath of staticAssetOutputPaths(true)) {
    assert.equal(await absent(path.join(outdir, relativePath)), true,
      `Blocker-only preparation must remove shared output: ${relativePath}`);
  }
  for (const relativePath of staticAssetOutputPaths(false).filter(
    (relativePath) => !staticAssetOutputPaths(true).includes(relativePath),
  )) {
    assert.equal(await absent(path.join(outdir, relativePath)), false,
      `Blocker-only preparation must not mutate new-tab output: ${relativePath}`);
  }

  await rm(outdir, { recursive: true, force: true });
  await symlink(protectedDirectory, outdir, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(
    () => prepareStaticAssetOutputs(root, tmpdir(), outdir, false),
    /symbolic link or junction/,
    "A build output replaced with a link after startup must be rejected before cleanup or writes",
  );
  assert.equal(await readFile(path.join(protectedDirectory, "sentinel.txt"), "utf8"), "external data must survive");

  console.log("Round 44 fixtures passed");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
