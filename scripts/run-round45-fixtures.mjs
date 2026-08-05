import assert from "node:assert/strict";
import { build as esbuildBuild } from "esbuild";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createBuildOutputLifecyclePlugin } from "./build-output-lifecycle.mjs";
import {
  bundleOutputPaths,
  generatedOutputPaths,
  prepareGeneratedOutputs,
  staticAssetOutputPaths,
} from "./static-asset-output.mjs";

const temporary = await mkdtemp(path.join(tmpdir(), "start-tab-round45-"));
const root = path.join(temporary, "project");
const outdir = path.join(root, "build-round45");
const entry = path.join(root, "src", "service-worker.js");

async function exists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (Boolean(error) && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function createGeneratedOutput(relativePath, content = relativePath) {
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

async function seedGeneratedOutputs(blockerOnly = false) {
  for (const relativePath of generatedOutputPaths(blockerOnly)) {
    await createGeneratedOutput(relativePath, `stale:${relativePath}`);
  }
}

async function assertGeneratedAbsent(blockerOnly = false) {
  for (const relativePath of generatedOutputPaths(blockerOnly)) {
    assert.equal(
      await exists(path.join(outdir, relativePath)),
      false,
      `Generated output must be absent after a failed build: ${relativePath}`,
    );
  }
}

function lifecyclePlugin({ blockerOnly = false, copyStaticAssets, log = () => {} }) {
  return createBuildOutputLifecyclePlugin({
    root,
    temporaryRoot: tmpdir(),
    outdir,
    blockerOnly,
    assertProductionGraph(metafile) {
      assert.ok(metafile && typeof metafile === "object", "Successful builds must expose an esbuild metafile");
    },
    copyStaticAssets,
    profile: blockerOnly ? "blocker-only fixture" : "full fixture",
    log,
  });
}

async function buildFixture({ source, plugin }) {
  await mkdir(path.dirname(entry), { recursive: true });
  await writeFile(entry, source, "utf8");
  return esbuildBuild({
    entryPoints: { "service-worker": entry },
    outdir,
    bundle: true,
    write: true,
    format: "esm",
    platform: "browser",
    metafile: true,
    logLevel: "silent",
    plugins: [plugin],
  });
}

try {
  const fullBundles = bundleOutputPaths(false);
  const blockerBundles = bundleOutputPaths(true);
  const fullStatic = staticAssetOutputPaths(false);
  const fullGenerated = generatedOutputPaths(false);
  assert.ok(fullBundles.includes("service-worker.js"));
  assert.ok(fullBundles.includes("newtab.js"));
  assert.equal(blockerBundles.includes("newtab.js"), false);
  assert.ok(fullStatic.includes("newtab-gate.js"));
  assert.equal(new Set(fullGenerated).size, fullGenerated.length, "Generated output paths must be unique");
  assert.deepEqual(fullGenerated, [...fullBundles, ...fullStatic]);

  await seedGeneratedOutputs(false);
  await createGeneratedOutput("keep.txt", "unrelated output survives");
  await prepareGeneratedOutputs(root, tmpdir(), outdir, true);
  await assertGeneratedAbsent(true);
  for (const relativePath of generatedOutputPaths(false).filter(
    (relativePath) => !generatedOutputPaths(true).includes(relativePath),
  )) {
    assert.equal(await exists(path.join(outdir, relativePath)), true,
      `Blocker-only invalidation must preserve full-profile-only output: ${relativePath}`);
  }
  assert.equal(await readFile(path.join(outdir, "keep.txt"), "utf8"), "unrelated output survives");

  await rm(outdir, { recursive: true, force: true });
  await seedGeneratedOutputs(false);
  await createGeneratedOutput("keep.txt", "unrelated output survives");
  let compileFailureCopyCalls = 0;
  await assert.rejects(() => buildFixture({
    source: "export const broken = ;",
    plugin: lifecyclePlugin({
      copyStaticAssets: async () => {
        compileFailureCopyCalls += 1;
      },
    }),
  }));
  assert.equal(compileFailureCopyCalls, 0, "Static finalization must not run after a compile failure");
  await assertGeneratedAbsent(false);
  assert.equal(await readFile(path.join(outdir, "keep.txt"), "utf8"), "unrelated output survives");

  await rm(outdir, { recursive: true, force: true });
  await seedGeneratedOutputs(false);
  await createGeneratedOutput("keep.txt", "unrelated output survives");
  await assert.rejects(() => buildFixture({
    source: "export const valid = true;",
    plugin: lifecyclePlugin({
      copyStaticAssets: async () => {
        await createGeneratedOutput("popup.html", "partial new output");
        await createGeneratedOutput("icons", "partial new icon tree");
        throw new Error("fixture finalization failure");
      },
    }),
  }), /fixture finalization failure/);
  await assertGeneratedAbsent(false);
  assert.equal(await readFile(path.join(outdir, "keep.txt"), "utf8"), "unrelated output survives");

  await rm(outdir, { recursive: true, force: true });
  const logMessages = [];
  await buildFixture({
    source: "export const valid = true;",
    plugin: lifecyclePlugin({
      copyStaticAssets: async () => {
        await createGeneratedOutput("popup.html", "fresh popup");
        await createGeneratedOutput("manifest.json", "fresh manifest");
      },
      log(message) {
        logMessages.push(message);
      },
    }),
  });
  assert.equal(await exists(path.join(outdir, "service-worker.js")), true,
    "A successful build must retain its fresh JavaScript bundle");
  assert.equal(await readFile(path.join(outdir, "popup.html"), "utf8"), "fresh popup");
  assert.equal(await readFile(path.join(outdir, "manifest.json"), "utf8"), "fresh manifest");
  assert.deepEqual(logMessages, [`Built full fixture extension at ${outdir}`]);

  console.log("Round 45 fixtures passed");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
