import assert from "node:assert/strict";
import { build as esbuildBuild, context as esbuildContext } from "esbuild";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createBuildOutputLifecyclePlugin } from "./build-output-lifecycle.mjs";
import { createStaticOutputWriter } from "./static-asset-finalization.mjs";
import {
  STATIC_ASSET_WATCH_IMPORT,
  assertValidStaticAssetTrees,
  collectStaticAssetWatchInputs,
  createStaticAssetWatchPlugin,
  explicitStaticAssetSources,
} from "./static-asset-watch.mjs";

const temporary = await mkdtemp(path.join(tmpdir(), "start-tab-round48-"));
const root = path.join(temporary, "project");
const protectedDirectory = path.join(temporary, "protected");
const protectedFile = path.join(protectedDirectory, "outside.html");
const entry = path.join(root, "src", "fixture.js");
const watchOutdir = path.join(root, "build-round48-watch");
const guardedOutdir = path.join(root, "build-round48-guarded");
const failureOutdir = path.join(root, "build-round48-failure");
const popupHtml = path.join(root, "src", "popup", "popup.html");

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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildObserver() {
  const queued = [];
  const waiters = [];

  return {
    plugin: {
      name: "round48-build-observer",
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
          reject(new Error("Timed out waiting for Round 48 esbuild watch rebuild"));
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
  await create("icons/icon.16.png", "icon\n");
}

let watchContext;
try {
  await mkdir(protectedDirectory, { recursive: true });
  await writeFile(protectedFile, "external sentinel", "utf8");
  await seedRequiredStaticInputs();
  await create("src/fixture.js", "export const fixture = true;\n");

  // Explicit static assets must be regular files. A link/junction in a path
  // such as popup.html must fail structurally and keep its parent watched.
  await rm(popupHtml, { force: true });
  if (process.platform === "win32") {
    await symlink(protectedDirectory, popupHtml, "junction");
  } else {
    await symlink(protectedFile, popupHtml, "file");
  }
  const linkedExplicitInputs = await collectStaticAssetWatchInputs(root, false);
  assert.ok(linkedExplicitInputs.invalidPaths.includes(path.resolve(popupHtml)),
    "Explicit static symlink/junction must be rejected as an invalid filesystem path");
  assert.ok(linkedExplicitInputs.watchDirs.includes(path.resolve(path.dirname(popupHtml))),
    "The explicit asset parent must remain watched for link recovery");

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
    (result) => result.errors.some((error) => /invalid filesystem path.*popup\.html/i.test(error.text)),
    "Watch must reject a linked explicit popup.html input",
  );

  await rm(popupHtml, { recursive: true, force: true });
  await nextMatching(
    observer,
    (result) => result.errors.some((error) => /Required static asset file is missing: .*popup\.html/i.test(error.text)),
    "Removing a linked explicit asset must become a recoverable missing-file error",
  );
  await writeFile(popupHtml, "restored popup", "utf8");
  await nextMatching(observer, (result) => result.errors.length === 0,
    "Recreating a missing explicit static file must recover the same watch process automatically");
  await watchContext.dispose();
  watchContext = undefined;

  // Reproduce the Round 47 gap deterministically: source validation completes,
  // then the output directory is replaced before the first copy. The guarded
  // writer must revalidate after the scan and refuse to invoke the copier.
  await mkdir(guardedOutdir, { recursive: true });
  await assertValidStaticAssetTrees(root, false);
  await rm(guardedOutdir, { recursive: true, force: true });
  await symlink(protectedDirectory, guardedOutdir, process.platform === "win32" ? "junction" : "dir");
  let guardedCopyCalls = 0;
  const guardedWriter = createStaticOutputWriter({
    root,
    temporaryRoot: tmpdir(),
    outdir: guardedOutdir,
    async copy() {
      guardedCopyCalls += 1;
    },
  });
  await assert.rejects(
    () => guardedWriter.copyOne(popupHtml, path.join(guardedOutdir, "popup.html")),
    /symbolic link or junction/i,
  );
  assert.equal(guardedCopyCalls, 0,
    "Output replacement after source validation must be rejected before the first static copy");
  assert.equal(await readFile(protectedFile, "utf8"), "external sentinel");
  assert.equal(await exists(path.join(protectedDirectory, "popup.html")), false,
    "Late output replacement must not create static output outside the build directory");
  await rm(guardedOutdir, { recursive: true, force: true });

  // A failing static batch must not return to lifecycle cleanup while another
  // sibling write is still running. The first delayed write must settle before
  // the second operation fails; cleanup then removes both bundle/static output
  // with no late writer left to recreate popup.html afterward.
  await mkdir(failureOutdir, { recursive: true });
  let delayedCopyFinished = false;
  const failureWriter = createStaticOutputWriter({
    root,
    temporaryRoot: tmpdir(),
    outdir: failureOutdir,
    async copy(from, to) {
      if (from === "delayed-static") {
        await delay(150);
        await writeFile(to, "late static write", "utf8");
        delayedCopyFinished = true;
        return;
      }
      throw new Error("fixture static copy failure");
    },
  });
  const lifecycle = createBuildOutputLifecyclePlugin({
    root,
    temporaryRoot: tmpdir(),
    outdir: failureOutdir,
    blockerOnly: false,
    assertProductionGraph(metafile) {
      assert.ok(metafile && typeof metafile === "object");
    },
    async copyStaticAssets() {
      await failureWriter.copyBatch([
        ["delayed-static", path.join(failureOutdir, "popup.html")],
        ["failing-static", path.join(failureOutdir, "popup.css")],
      ]);
    },
    profile: "Round 48 serialized static failure fixture",
    log() {},
  });

  let finalizationFailure;
  try {
    await esbuildBuild({
      entryPoints: { popup: entry },
      outdir: failureOutdir,
      bundle: true,
      write: true,
      format: "esm",
      platform: "browser",
      metafile: true,
      logLevel: "silent",
      plugins: [lifecycle],
    });
  } catch (error) {
    finalizationFailure = error;
  }
  assert.ok(finalizationFailure, "Static copy failure must fail finalization");
  assert.equal(delayedCopyFinished, true,
    "Serialized static batch must wait for the delayed copy before exposing the later failure");
  assert.equal(await exists(path.join(failureOutdir, "popup.js")), false,
    "Lifecycle cleanup must remove the generated bundle after static finalization failure");
  assert.equal(await exists(path.join(failureOutdir, "popup.html")), false,
    "Lifecycle cleanup must remove the completed partial static write");
  await delay(250);
  assert.equal(await exists(path.join(failureOutdir, "popup.html")), false,
    "No in-flight static writer may recreate output after failure cleanup has completed");

  console.log("Round 48 fixtures passed");
} finally {
  if (watchContext) await watchContext.dispose();
  await rm(temporary, { recursive: true, force: true });
}
