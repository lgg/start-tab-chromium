import assert from "node:assert/strict";
import { build as esbuildBuild } from "esbuild";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createBuildOutputLifecyclePlugin } from "./build-output-lifecycle.mjs";
import { createStaticOutputWriter } from "./static-asset-finalization.mjs";
import {
  assertValidStaticAssetTrees,
  assertValidStaticCopySource,
  explicitStaticAssetSources,
} from "./static-asset-watch.mjs";

const temporary = await mkdtemp(path.join(tmpdir(), "start-tab-round49-"));
const root = path.join(temporary, "project");
const protectedDirectory = path.join(temporary, "protected");
const protectedFile = path.join(protectedDirectory, "sentinel.json");
const entry = path.join(root, "src", "fixture.js");
const sourceOutdir = path.join(root, "build-round49-source");
const exactOutdir = path.join(root, "build-round49-exact");
const lateBundleOutdir = path.join(root, "build-round49-late-bundle");
const successOutdir = path.join(root, "build-round49-success");
const popupHtml = path.join(root, "src", "popup", "popup.html");
const manifestJson = path.join(root, "src", "manifest.json");
const iconsRoot = path.join(root, "icons");

async function create(relativePath, content = relativePath) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return path.resolve(target);
}

async function exists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (Boolean(error) && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function seedRequiredStaticInputs() {
  await create("src/manifest.json", "{}\n");
  for (const source of explicitStaticAssetSources(root, false)) {
    const relative = path.relative(root, source);
    if (relative === path.join("src", "manifest.json")) continue;
    await create(relative, relative);
  }
  await create("src/_locales/en/messages.json", "{}\n");
  await create("icons/icon.16.png", "icon\n");
}

async function replaceWithLink(target, externalFile = protectedFile) {
  await rm(target, { recursive: true, force: true });
  if (process.platform === "win32") {
    await symlink(protectedDirectory, target, "junction");
  } else {
    await symlink(externalFile, target, "file");
  }
}

try {
  await mkdir(protectedDirectory, { recursive: true });
  await writeFile(protectedFile, "external sentinel", "utf8");
  await seedRequiredStaticInputs();
  await create("src/fixture.js", "export const fixture = true;\n");
  await mkdir(sourceOutdir, { recursive: true });

  // The whole-tree preflight is not enough on its own. Replacing one explicit
  // source after that scan must be caught again immediately before cp().
  await assertValidStaticAssetTrees(root, false);
  await replaceWithLink(popupHtml);
  let copyCalls = 0;
  let readCalls = 0;
  const sourceWriter = createStaticOutputWriter({
    root,
    temporaryRoot: tmpdir(),
    outdir: sourceOutdir,
    assertSourceSafe: assertValidStaticCopySource,
    async copy() {
      copyCalls += 1;
    },
    async read() {
      readCalls += 1;
      return "{}";
    },
  });
  await assert.rejects(
    () => sourceWriter.copyOne(popupHtml, path.join(sourceOutdir, "popup.html")),
    /invalid filesystem path/i,
  );
  assert.equal(copyCalls, 0,
    "A static source replaced after whole-tree validation must be rejected before cp is invoked");
  await rm(popupHtml, { recursive: true, force: true });
  await writeFile(popupHtml, "restored popup", "utf8");

  // The transformed manifest is read near the end of finalization, so it also
  // needs a concrete source guard instead of relying on the earlier scan.
  await assertValidStaticAssetTrees(root, false);
  await replaceWithLink(manifestJson);
  await assert.rejects(
    () => sourceWriter.readOne(manifestJson, "utf8"),
    /invalid filesystem path/i,
  );
  assert.equal(readCalls, 0,
    "Manifest replacement after whole-tree validation must be rejected before readFile is invoked");
  await rm(manifestJson, { recursive: true, force: true });
  await writeFile(manifestJson, "{}\n", "utf8");

  // Recursive roots must receive the same per-operation revalidation before a
  // recursive copy starts, including nested link/special-entry detection.
  await assertValidStaticAssetTrees(root, false);
  await rm(iconsRoot, { recursive: true, force: true });
  await symlink(protectedDirectory, iconsRoot, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(
    () => sourceWriter.copyOne(iconsRoot, path.join(sourceOutdir, "icons"), { recursive: true }),
    /invalid filesystem path/i,
  );
  assert.equal(copyCalls, 0,
    "A recursive static root replaced after preflight must be rejected before cp is invoked");
  await rm(iconsRoot, { recursive: true, force: true });
  await create("icons/icon.16.png", "icon\n");

  // Bundle finalization must reject incomplete or unexpected esbuild output
  // sets before writing any member of the batch.
  await mkdir(exactOutdir, { recursive: true });
  const exactWriter = createStaticOutputWriter({ root, temporaryRoot: tmpdir(), outdir: exactOutdir });
  const popupBundle = {
    path: path.join(exactOutdir, "popup.js"),
    contents: Buffer.from("export const popup = true;\n"),
  };
  const unexpectedBundle = {
    path: path.join(exactOutdir, "unexpected.js"),
    contents: Buffer.from("unexpected\n"),
  };
  await assert.rejects(
    () => exactWriter.writeOutputFiles([popupBundle, unexpectedBundle], ["popup.js"]),
    /unexpected esbuild output set/i,
  );
  assert.equal(await exists(path.join(exactOutdir, "popup.js")), false,
    "Unexpected bundle output must fail before any expected bundle is written");
  await assert.rejects(
    () => exactWriter.writeOutputFiles([], ["popup.js"]),
    /missing=\[popup\.js\]/i,
  );
  await exactWriter.writeOutputFiles([popupBundle], ["popup.js"]);
  assert.match(await readFile(path.join(exactOutdir, "popup.js"), "utf8"), /popup = true/);

  // Reproduce the unguarded-bundle gap from Round 48. esbuild compiles fully in
  // memory. After the lifecycle's post-compile output check, replace outdir with
  // a junction/symlink immediately before the bundle writer. The per-write guard
  // must reject the replacement and nothing may appear in the external target.
  const lateWriter = createStaticOutputWriter({ root, temporaryRoot: tmpdir(), outdir: lateBundleOutdir });
  let staticFinalizationCalls = 0;
  const lateLifecycle = createBuildOutputLifecyclePlugin({
    root,
    temporaryRoot: tmpdir(),
    outdir: lateBundleOutdir,
    blockerOnly: false,
    assertProductionGraph(metafile) {
      assert.ok(metafile && typeof metafile === "object");
    },
    async validateFinalizationInputs() {},
    async writeBundleOutputs(outputFiles) {
      await rm(lateBundleOutdir, { recursive: true, force: true });
      await symlink(protectedDirectory, lateBundleOutdir, process.platform === "win32" ? "junction" : "dir");
      await lateWriter.writeOutputFiles(outputFiles, ["popup.js"]);
    },
    async copyStaticAssets() {
      staticFinalizationCalls += 1;
    },
    profile: "Round 49 late bundle replacement fixture",
    log() {},
  });

  let lateBundleFailure;
  try {
    await esbuildBuild({
      entryPoints: { popup: entry },
      outdir: lateBundleOutdir,
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      metafile: true,
      logLevel: "silent",
      plugins: [lateLifecycle],
    });
  } catch (error) {
    lateBundleFailure = error;
  }
  assert.ok(lateBundleFailure, "Late output replacement before bundle finalization must fail the build");
  assert.equal(staticFinalizationCalls, 0,
    "Static finalization must not run after guarded bundle finalization rejects a late output link");
  assert.equal(await exists(path.join(protectedDirectory, "popup.js")), false,
    "A late output link must not receive an esbuild JavaScript bundle");
  assert.equal(await readFile(protectedFile, "utf8"), "external sentinel");
  await rm(lateBundleOutdir, { recursive: true, force: true });

  // Real esbuild outputFiles must be accepted and written by the lifecycle when
  // the exact expected set is present.
  const successWriter = createStaticOutputWriter({ root, temporaryRoot: tmpdir(), outdir: successOutdir });
  let receivedOutputFiles = 0;
  const successLifecycle = createBuildOutputLifecyclePlugin({
    root,
    temporaryRoot: tmpdir(),
    outdir: successOutdir,
    blockerOnly: false,
    assertProductionGraph(metafile) {
      assert.ok(metafile && typeof metafile === "object");
    },
    async validateFinalizationInputs() {},
    async writeBundleOutputs(outputFiles) {
      receivedOutputFiles = outputFiles.length;
      await successWriter.writeOutputFiles(outputFiles, ["popup.js"]);
    },
    async copyStaticAssets() {},
    profile: "Round 49 in-memory bundle fixture",
    log() {},
  });
  await esbuildBuild({
    entryPoints: { popup: entry },
    outdir: successOutdir,
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    metafile: true,
    logLevel: "silent",
    plugins: [successLifecycle],
  });
  assert.equal(receivedOutputFiles, 1,
    "Lifecycle must receive the real in-memory esbuild output file instead of relying on direct filesystem writes");
  assert.equal(await exists(path.join(successOutdir, "popup.js")), true,
    "Guarded lifecycle must materialize the expected JavaScript bundle after successful compilation");

  console.log("Round 49 fixtures passed");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
