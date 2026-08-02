import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build as esbuildBuild } from "esbuild";

import {
  STATIC_ASSET_WATCH_IMPORT,
  collectStaticAssetWatchInputs,
  createStaticAssetWatchPlugin,
  explicitStaticAssetSources,
} from "./static-asset-watch.mjs";

const root = await mkdtemp(path.join(tmpdir(), "start-tab-round43-"));

async function create(relativePath, content = relativePath) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return path.resolve(target);
}

try {
  const required = [
    "src/manifest.json",
    "src/popup/popup.html",
    "src/popup/popup.css",
    "src/blocked/blocked.html",
    "src/blocked/blocked.css",
    "src/options/options.html",
    "src/options/options.css",
    "src/shared-ui.css",
    "src/newtab/newtab.html",
    "src/newtab/newtab.css",
    "src/newtab/newtab-gate.js",
    "icons/icon.16.png",
    "icons/nested/icon.extra.png",
    "src/_locales/en/messages.json",
    "src/_locales/ru/nested/messages.json",
  ];
  const created = new Map();
  for (const relativePath of required) created.set(relativePath, await create(relativePath));

  const fullExplicit = explicitStaticAssetSources(root, false);
  const blockerExplicit = explicitStaticAssetSources(root, true);
  assert.ok(fullExplicit.includes(created.get("src/newtab/newtab-gate.js")));
  assert.equal(blockerExplicit.includes(created.get("src/newtab/newtab-gate.js")), false);
  assert.ok(blockerExplicit.includes(created.get("src/manifest.json")));

  const full = await collectStaticAssetWatchInputs(root, false);
  const blocker = await collectStaticAssetWatchInputs(root, true);
  for (const relativePath of required) {
    const absolute = created.get(relativePath);
    if (relativePath.startsWith("src/newtab/")) {
      assert.ok(full.watchFiles.includes(absolute), `Full watch set is missing ${relativePath}`);
      assert.equal(blocker.watchFiles.includes(absolute), false, `Blocker watch set must omit ${relativePath}`);
    } else {
      assert.ok(full.watchFiles.includes(absolute), `Full watch set is missing ${relativePath}`);
      assert.ok(blocker.watchFiles.includes(absolute), `Blocker watch set is missing ${relativePath}`);
    }
  }
  assert.equal(new Set(full.watchFiles).size, full.watchFiles.length, "Watch files must be unique");
  assert.equal(new Set(full.watchDirs).size, full.watchDirs.length, "Watch directories must be unique");
  assert.ok(full.watchDirs.includes(path.resolve(root, "icons", "nested")));
  assert.ok(full.watchDirs.includes(path.resolve(root, "src", "_locales", "ru", "nested")));

  let resolveRegistration;
  let loadRegistration;
  const plugin = createStaticAssetWatchPlugin(root, false);
  plugin.setup({
    onResolve(options, callback) {
      resolveRegistration = { options, callback };
    },
    onLoad(options, callback) {
      loadRegistration = { options, callback };
    },
  });
  assert.equal(plugin.name, "watch-static-extension-assets");
  assert.ok(resolveRegistration.options.filter.test(STATIC_ASSET_WATCH_IMPORT));
  const resolved = resolveRegistration.callback({ path: STATIC_ASSET_WATCH_IMPORT });
  assert.equal(resolved.namespace, "start-tab-static-assets");
  const loaded = await loadRegistration.callback({ path: resolved.path, namespace: resolved.namespace });
  assert.equal(loaded.contents, "");
  assert.equal(loaded.loader, "js");
  assert.ok(loaded.watchFiles.includes(created.get("src/manifest.json")));
  assert.ok(loaded.watchDirs.includes(path.resolve(root, "icons")));

  const smoke = await esbuildBuild({
    stdin: {
      contents: "export const fixture = true;",
      sourcefile: "round43-smoke.js",
      resolveDir: root,
    },
    bundle: true,
    write: false,
    format: "esm",
    logLevel: "silent",
    inject: [STATIC_ASSET_WATCH_IMPORT],
    plugins: [createStaticAssetWatchPlugin(root, false)],
  });
  assert.equal(smoke.errors.length, 0);
  assert.equal(smoke.outputFiles?.length, 1, "The virtual watch module must be accepted by a real esbuild build");

  console.log("Round 43 fixtures passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
