import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(new URL("../", import.meta.url)));

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

async function assertExists(path) {
  await access(resolve(root, path));
}

function sortedKeys(value) {
  return Object.keys(value).sort((a, b) => a.localeCompare(b));
}

function assertMessageCatalog(name, catalog) {
  for (const [key, value] of Object.entries(catalog)) {
    assert.equal(typeof value, "object", `${name}.${key} must be an object`);
    assert.notEqual(value, null, `${name}.${key} must not be null`);
    assert.equal(typeof value.message, "string", `${name}.${key}.message must be a string`);
    assert.ok(value.message.length > 0, `${name}.${key}.message must not be empty`);
  }
}

function assertCiRetentionPolicy(ci) {
  if (ci.includes("actions/upload-artifact")) {
    assert.match(ci, /retention-days:\s*1\b/, "GitHub artifact uploads must set retention-days: 1");
  }
  assert.doesNotMatch(ci, /actions\/cache@/, "Explicit GitHub Actions cache is not expected for this extension CI");
}

const staticAssets = [
  "src/_locales/en/messages.json",
  "src/_locales/ru/messages.json",
  "src/popup/popup.html",
  "src/popup/popup.css",
  "src/blocked/blocked.html",
  "src/blocked/blocked.css",
  "src/newtab/newtab.html",
  "src/newtab/newtab.css",
  "src/newtab/instances.css",
  "src/newtab/newtab-gate.js",
  "src/newtab/editor.js",
  "src/newtab/ip.js",
  "src/newtab/instances.js",
  "src/options/options.html",
  "src/options/options.css",
  "src/options/options-helper.js",
  "src/options/background-presets.js",
  "icons/icon.16.png",
  "icons/icon.48.png",
  "icons/icon.128.png",
];

const [manifest, packageJson, enMessages, ruMessages] = await Promise.all([
  readJson("src/manifest.json"),
  readJson("package.json"),
  readJson("src/_locales/en/messages.json"),
  readJson("src/_locales/ru/messages.json"),
]);

assert.equal(manifest.manifest_version, 3, "manifest must stay on MV3");
assert.equal(manifest.default_locale, "en", "manifest default locale must match the bundled English catalog");
assert.equal(manifest.background?.service_worker, "service-worker.js", "MV3 service worker path must match the build output");
assert.equal(manifest.chrome_url_overrides?.newtab, "newtab.html", "full build manifest must keep Start Tab new tab override");

for (const size of ["16", "48", "128"]) {
  const icon = manifest.icons?.[size];
  assert.equal(typeof icon, "string", `manifest icon ${size} must be configured`);
  await assertExists(icon);
}

assert.ok(Array.isArray(manifest.permissions), "manifest permissions must be an array");
for (const permission of ["storage", "declarativeNetRequest", "webNavigation"]) {
  assert.ok(manifest.permissions.includes(permission), `manifest permission ${permission} is required for current features`);
}

assert.equal(packageJson.type, "module", "package must remain ESM for build/test scripts");
for (const script of ["build", "build:blocker-only", "typecheck", "test"]) {
  assert.equal(typeof packageJson.scripts?.[script], "string", `package script ${script} must exist`);
}

assertMessageCatalog("en", enMessages);
assertMessageCatalog("ru", ruMessages);
assert.deepEqual(sortedKeys(ruMessages), sortedKeys(enMessages), "English and Russian locale catalogs must expose the same message keys");

await Promise.all(staticAssets.map(assertExists));

const [buildScript, ci] = await Promise.all([
  readFile(resolve(root, "build.mjs"), "utf8"),
  readFile(resolve(root, ".github/workflows/ci.yml"), "utf8"),
]);

for (const asset of staticAssets.filter((asset) => !asset.startsWith("icons/icon."))) {
  const buildAsset = asset === "src/_locales/en/messages.json" || asset === "src/_locales/ru/messages.json"
    ? "src/_locales"
    : asset;
  assert.ok(buildScript.includes(buildAsset), `build.mjs must copy ${buildAsset}`);
}

assert.match(ci, /npm run test/, "CI must run the static validation test suite");
assert.match(ci, /npm run typecheck/, "CI must run TypeScript typecheck");
assert.match(ci, /npm run build\b/, "CI must build the full extension");
assert.match(ci, /npm run build:blocker-only/, "CI must build the blocker-only variant");
assertCiRetentionPolicy(ci);

console.log("Static validation passed");
