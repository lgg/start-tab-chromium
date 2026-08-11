import assert from "node:assert/strict";
import { context as esbuildContext } from "esbuild";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  STATIC_ASSET_WATCH_IMPORT,
  collectStaticAssetWatchInputs,
  createStaticAssetWatchPlugin,
  explicitStaticAssetSources,
} from "./static-asset-watch.mjs";
import { prepareGeneratedOutputs } from "./static-asset-output.mjs";

const root = await mkdtemp(path.join(tmpdir(), "start-tab-round46-"));
const entry = path.join(root, "src", "fixture.js");
const outdir = path.join(root, "build-round46");

async function create(relativePath, content = relativePath) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return path.resolve(target);
}

function buildObserver() {
  const queued = [];
  const waiters = [];

  return {
    plugin: {
      name: "round46-build-observer",
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
          reject(new Error("Timed out waiting for esbuild watch rebuild"));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
  };
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

let watchContext;
try {
  await seedRequiredStaticInputs();
  await create("src/fixture.js", "export const fixture = true;\n");

  const missing = await collectStaticAssetWatchInputs(root, false);
  assert.deepEqual(missing.missingDirectories, [path.resolve(root, "icons")]);
  assert.ok(missing.watchDirs.includes(path.resolve(root)),
    "The repository root must stay watched so a missing root icons directory can be recreated");
  assert.ok(missing.watchDirs.includes(path.resolve(root, "src")),
    "The source root must stay watched so a missing locale root can be recreated");
  assert.equal(missing.watchDirs.includes(path.resolve(root, "icons")), false,
    "A missing directory itself must not be registered as an existing watch directory");

  let loadRegistration;
  const staticPlugin = createStaticAssetWatchPlugin(root, false);
  staticPlugin.setup({
    onResolve() {},
    onLoad(options, callback) {
      loadRegistration = { options, callback };
    },
  });
  const loaded = await loadRegistration.callback({ path: "anchor", namespace: "start-tab-static-assets" });
  assert.ok(loaded.watchDirs.includes(path.resolve(root)));
  assert.match(loaded.errors?.[0]?.text ?? "", /Required static asset directory is missing: .*icons/);

  const observer = buildObserver();
  watchContext = await esbuildContext({
    entryPoints: [entry],
    outdir,
    bundle: true,
    write: false,
    format: "esm",
    logLevel: "silent",
    inject: [STATIC_ASSET_WATCH_IMPORT],
    plugins: [createStaticAssetWatchPlugin(root, false), observer.plugin],
  });
  await watchContext.watch();

  const initial = await observer.next();
  assert.ok(initial.errors.length > 0, "Watch must fail visibly while the required icons root is missing");
  assert.match(initial.errors.map((error) => error.text).join("\n"), /Required static asset directory is missing: .*icons/);

  await mkdir(path.join(root, "icons"), { recursive: true });
  const recovered = await observer.next();
  assert.equal(recovered.errors.length, 0,
    "Creating a previously missing root static directory must trigger an automatic successful rebuild");

  await rm(path.join(root, "icons"), { recursive: true, force: true });
  const removed = await observer.next();
  assert.ok(removed.errors.length > 0, "Deleting the root icons directory must invalidate the watch build");

  await mkdir(path.join(root, "icons"), { recursive: true });
  const restored = await observer.next();
  assert.equal(restored.errors.length, 0,
    "Restoring the root icons directory after a failed rebuild must recover without a source-code edit");

  await mkdir(outdir, { recursive: true });
  await writeFile(path.join(outdir, "keep.txt"), "unrelated startup output", "utf8");
  await writeFile(path.join(outdir, "popup.js"), "stale generated output", "utf8");
  await prepareGeneratedOutputs(root, tmpdir(), outdir, false);
  assert.equal(await readFile(path.join(outdir, "keep.txt"), "utf8"), "unrelated startup output");
  await assert.rejects(() => readFile(path.join(outdir, "popup.js"), "utf8"), { code: "ENOENT" });

  console.log("Round 46 fixtures passed");
} finally {
  if (watchContext) await watchContext.dispose();
  await rm(root, { recursive: true, force: true });
}
