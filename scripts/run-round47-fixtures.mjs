import assert from "node:assert/strict";
import { build as esbuildBuild, context as esbuildContext } from "esbuild";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createBuildOutputLifecyclePlugin } from "./build-output-lifecycle.mjs";
import {
  STATIC_ASSET_WATCH_IMPORT,
  collectStaticAssetWatchInputs,
  createStaticAssetWatchPlugin,
  explicitStaticAssetSources,
} from "./static-asset-watch.mjs";
import { generatedOutputPaths, prepareGeneratedOutputs } from "./static-asset-output.mjs";

const temporary = await mkdtemp(path.join(tmpdir(), "start-tab-round47-"));
const root = path.join(temporary, "project");
const entry = path.join(root, "src", "fixture.js");
const watchOutdir = path.join(root, "build-round47-watch");
const lateSwapOutdir = path.join(root, "build-round47-late-swap");
const profileOutdir = path.join(root, "build-round47-profile");
const protectedDirectory = path.join(temporary, "protected");
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

function buildObserver() {
  const queued = [];
  const waiters = [];

  return {
    plugin: {
      name: "round47-build-observer",
      setup(build) {
        build.onEnd((result) => {
          const waiter = waiters.shift();
          if (waiter) waiter.resolve(result);
          else queued.push(result);
        });
      },
    },
    next(timeoutMs = 12_000) {
      if (queued.length > 0) return Promise.resolve(queued.shift());
      return new Promise((resolve, reject) => {
        const waiter = {
          resolve(result) {
            clearTimeout(timer);
            resolve(result);
          },
        };
        const timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error("Timed out waiting for Round 47 esbuild watch rebuild"));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
  };
}

async function nextMatching(observer, predicate, label, attempts = 6) {
  const seen = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await observer.next();
    seen.push(result.errors.map((error) => error.text).join("\n"));
    if (predicate(result)) return result;
  }
  throw new Error(`${label}; observed rebuild errors:\n${seen.join("\n---\n")}`);
}

async function seedRequiredStaticInputs() {
  await create("src/manifest.json", "{}\n");
  for (const source of explicitStaticAssetSources(root, false)) {
    const relative = path.relative(root, source);
    if (relative === path.join("src", "manifest.json")) continue;
    await create(relative, relative);
  }
  await create("src/_locales/en/messages.json", "{}\n");
}

async function seedGeneratedOutputs(outdir) {
  for (const relativePath of generatedOutputPaths(false)) {
    const target = path.join(outdir, relativePath);
    if (relativePath === "icons" || relativePath === "_locales") {
      await mkdir(target, { recursive: true });
      await writeFile(path.join(target, "stale.txt"), relativePath, "utf8");
    } else {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, relativePath, "utf8");
    }
  }
}

let watchContext;
try {
  await mkdir(protectedDirectory, { recursive: true });
  await writeFile(path.join(protectedDirectory, "sentinel.txt"), "external data must survive", "utf8");
  await seedRequiredStaticInputs();
  await create("src/fixture.js", "export const fixture = true;\n");

  // A reusable --outdir must become an exact blocker-only artifact even when
  // it previously contained a full build.
  await seedGeneratedOutputs(profileOutdir);
  await writeFile(path.join(profileOutdir, "keep.txt"), "unrelated output survives", "utf8");
  await prepareGeneratedOutputs(root, tmpdir(), profileOutdir, true);
  for (const relativePath of generatedOutputPaths(false)) {
    assert.equal(await exists(path.join(profileOutdir, relativePath)), false,
      `Blocker-only cleanup must remove stale generated output from any profile: ${relativePath}`);
  }
  assert.equal(await readFile(path.join(profileOutdir, "keep.txt"), "utf8"), "unrelated output survives");

  // Wrong-type recursive roots must fail as structured watch errors while
  // keeping their existing parent under observation for recovery.
  await writeFile(iconsRoot, "wrong type", "utf8");
  const wrongTypeInputs = await collectStaticAssetWatchInputs(root, false);
  assert.deepEqual(wrongTypeInputs.invalidPaths, [path.resolve(iconsRoot)]);
  assert.ok(wrongTypeInputs.watchDirs.includes(path.resolve(root)),
    "The repository root must remain watched while icons is the wrong filesystem type");

  const observer = buildObserver();
  watchContext = await esbuildContext({
    entryPoints: [entry],
    outdir: watchOutdir,
    bundle: true,
    write: false,
    format: "esm",
    logLevel: "silent",
    inject: [STATIC_ASSET_WATCH_IMPORT],
    plugins: [createStaticAssetWatchPlugin(root, false), observer.plugin],
  });
  await watchContext.watch();

  await nextMatching(
    observer,
    (result) => result.errors.some((error) => /invalid filesystem path.*icons/i.test(error.text)),
    "Watch must fail visibly while icons is a regular file",
  );

  await rm(iconsRoot, { force: true });
  await nextMatching(
    observer,
    (result) => result.errors.some((error) => /Required static asset directory is missing: .*icons/i.test(error.text)),
    "Removing the wrong-type icons root must remain recoverable as a missing-directory build",
  );
  await mkdir(iconsRoot, { recursive: true });
  await nextMatching(observer, (result) => result.errors.length === 0,
    "Restoring icons as a real directory must recover automatically");

  // A root junction/symlink must never be traversed into external data.
  await rm(iconsRoot, { recursive: true, force: true });
  await nextMatching(
    observer,
    (result) => result.errors.some((error) => /Required static asset directory is missing: .*icons/i.test(error.text)),
    "Deleting icons before the junction fixture must be observed",
  );
  await symlink(protectedDirectory, iconsRoot, process.platform === "win32" ? "junction" : "dir");
  await nextMatching(
    observer,
    (result) => result.errors.some((error) => /invalid filesystem path.*icons/i.test(error.text)),
    "A linked root static directory must fail without being traversed",
  );
  const linkedInputs = await collectStaticAssetWatchInputs(root, false);
  assert.ok(linkedInputs.invalidPaths.includes(path.resolve(iconsRoot)));
  assert.equal(linkedInputs.watchFiles.some((file) => file.startsWith(path.resolve(protectedDirectory))), false,
    "External files behind a linked static root must never enter watchFiles");
  assert.equal(await readFile(path.join(protectedDirectory, "sentinel.txt"), "utf8"), "external data must survive");

  await rm(iconsRoot, { recursive: true, force: true });
  await nextMatching(
    observer,
    (result) => result.errors.some((error) => /Required static asset directory is missing: .*icons/i.test(error.text)),
    "Removing the linked root must remain recoverable",
  );
  await mkdir(iconsRoot, { recursive: true });
  await nextMatching(observer, (result) => result.errors.length === 0,
    "Replacing the linked root with a real directory must recover automatically");

  // Nested special entries must also fail structurally while their containing
  // directory stays watched, then recover when the entry is removed.
  const nestedLink = path.join(iconsRoot, "external-link");
  await symlink(protectedDirectory, nestedLink, process.platform === "win32" ? "junction" : "dir");
  await nextMatching(
    observer,
    (result) => result.errors.some((error) => /invalid filesystem path.*external-link/i.test(error.text)),
    "A nested static-tree link must fail visibly without aborting watch metadata collection",
  );
  await rm(nestedLink, { recursive: true, force: true });
  await nextMatching(observer, (result) => result.errors.length === 0,
    "Removing a nested invalid static entry must recover automatically");

  await watchContext.dispose();
  watchContext = undefined;

  // Simulate an output directory being replaced after esbuild has written its
  // bundles but before lifecycle static finalization. The revalidation in the
  // lifecycle must reject the link before copyStaticAssets can write through it.
  let copyStaticCalls = 0;
  const swapOutputBeforeFinalization = {
    name: "round47-swap-output-before-finalization",
    setup(build) {
      build.onEnd(async (result) => {
        if (result.errors.length > 0) return;
        await rm(lateSwapOutdir, { recursive: true, force: true });
        await symlink(protectedDirectory, lateSwapOutdir, process.platform === "win32" ? "junction" : "dir");
      });
    },
  };
  const lifecycle = createBuildOutputLifecyclePlugin({
    root,
    temporaryRoot: tmpdir(),
    outdir: lateSwapOutdir,
    blockerOnly: false,
    assertProductionGraph(metafile) {
      assert.ok(metafile && typeof metafile === "object");
    },
    async copyStaticAssets() {
      copyStaticCalls += 1;
      await writeFile(path.join(lateSwapOutdir, "popup.html"), "must never escape", "utf8");
    },
    profile: "Round 47 late-link fixture",
    log() {},
  });

  let lateSwapFailure;
  try {
    await esbuildBuild({
      entryPoints: { fixture: entry },
      outdir: lateSwapOutdir,
      bundle: true,
      write: true,
      format: "esm",
      platform: "browser",
      metafile: true,
      logLevel: "silent",
      plugins: [swapOutputBeforeFinalization, lifecycle],
    });
  } catch (error) {
    lateSwapFailure = error;
  }
  assert.ok(lateSwapFailure, "Late output-link replacement must fail the build");
  assert.equal(copyStaticCalls, 0, "Static finalization must not run through a late output junction or symlink");
  assert.equal(await exists(path.join(protectedDirectory, "popup.html")), false,
    "Late output-link rejection must prevent static writes outside the build directory");
  assert.equal(await readFile(path.join(protectedDirectory, "sentinel.txt"), "utf8"), "external data must survive");

  console.log("Round 47 fixtures passed");
} finally {
  if (watchContext) await watchContext.dispose();
  await rm(temporary, { recursive: true, force: true });
}
