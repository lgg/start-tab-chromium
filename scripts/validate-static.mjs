import assert from "node:assert/strict";
import { build } from "esbuild";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
}

async function exists(relativePath) {
  try {
    await access(resolve(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else files.push(absolute);
  }
  return files;
}

function sortedKeys(value) {
  return Object.keys(value).sort((left, right) => left.localeCompare(right));
}

function assertCatalog(name, catalog) {
  for (const [key, value] of Object.entries(catalog)) {
    assert.equal(typeof value, "object", `${name}.${key} must be an object`);
    assert.notEqual(value, null, `${name}.${key} must not be null`);
    assert.equal(typeof value.message, "string", `${name}.${key}.message must be a string`);
    assert.ok(value.message.length > 0, `${name}.${key}.message must not be empty`);
  }
}

function assertCiPolicy(ci) {
  assert.doesNotMatch(
    ci,
    /actions\/upload-artifact|Compress-Archive|retention-days:/,
    "PR CI must not upload or package build artifacts",
  );
  assert.match(ci, /uses: actions\/cache\/restore@v5/, "CI must restore only the npm download cache");
  assert.match(ci, /uses: actions\/cache\/save@v5/, "CI must save only the npm download cache");
  assert.doesNotMatch(ci, /path:\s*node_modules/, "CI must not cache node_modules");
}

const [manifest, packageJson, enMessages, enRound7Messages, ruBaseMessages, ruRoadmapMessages, ruRound7Messages, ci, rootBuild, canonicalBuild, newtabHtml, optionsHtml, settingsSource, runtimeRendererSource, serviceWorkerSource] = await Promise.all([
  readJson("src/manifest.json"),
  readJson("package.json"),
  readJson("src/_locales/en/messages.json"),
  readJson("src/_locales/en/round7-messages.json"),
  readJson("src/_locales/ru/messages.json"),
  readJson("src/_locales/ru/roadmap-messages.json"),
  readJson("src/_locales/ru/round7-messages.json"),
  readFile(resolve(root, ".github/workflows/ci.yml"), "utf8"),
  readFile(resolve(root, "build.mjs"), "utf8"),
  readFile(resolve(root, "scripts/build.mjs"), "utf8"),
  readFile(resolve(root, "src/newtab/newtab.html"), "utf8"),
  readFile(resolve(root, "src/options/options.html"), "utf8"),
  readFile(resolve(root, "src/lib/start-page-settings.ts"), "utf8"),
  readFile(resolve(root, "src/newtab/block-renderers-runtime.ts"), "utf8"),
  readFile(resolve(root, "src/service-worker.ts"), "utf8"),
]);
const effectiveEnMessages = { ...enMessages, ...enRound7Messages };
const ruMessages = { ...ruBaseMessages, ...ruRoadmapMessages, ...ruRound7Messages };

assert.equal(manifest.manifest_version, 3, "Manifest must remain MV3");
assert.equal(manifest.version, packageJson.version, "Package and manifest versions must match");
assert.equal(manifest.default_locale, "en");
assert.equal(manifest.background?.service_worker, "service-worker.js");
assert.equal(manifest.chrome_url_overrides?.newtab, "newtab.html");
for (const permission of ["storage", "alarms", "notifications", "declarativeNetRequest", "webNavigation"]) {
  assert.ok(manifest.permissions?.includes(permission), `Manifest permission ${permission} is required`);
}

assertCatalog("en", enMessages);
assertCatalog("ru-base", ruBaseMessages);
assertCatalog("en-round7", enRound7Messages);
assertCatalog("ru-roadmap", ruRoadmapMessages);
assertCatalog("ru-round7", ruRound7Messages);
const englishKeys = sortedKeys(effectiveEnMessages);
const russianKeys = sortedKeys(ruMessages);
const missingRussianKeys = englishKeys.filter((key) => !Object.prototype.hasOwnProperty.call(ruMessages, key));
const extraRussianKeys = russianKeys.filter((key) => !Object.prototype.hasOwnProperty.call(effectiveEnMessages, key));
assert.deepEqual(missingRussianKeys, [], `Russian catalog is missing keys: ${missingRussianKeys.join(", ")}`);
assert.deepEqual(extraRussianKeys, [], `Russian catalog has obsolete keys: ${extraRussianKeys.join(", ")}`);

for (const relativePath of [
  "src/_locales/en/messages.json",
  "src/_locales/en/round7-messages.json",
  "src/_locales/ru/messages.json",
  "src/_locales/ru/roadmap-messages.json",
  "src/_locales/ru/round7-messages.json",
  "src/popup/popup.html",
  "src/popup/popup.css",
  "src/blocked/blocked.html",
  "src/blocked/blocked.css",
  "src/options/options.html",
  "src/options/options.css",
  "src/newtab/newtab.html",
  "src/newtab/newtab.css",
  "src/newtab/newtab-gate.js",
  "src/shared-ui.css",
  "icons/icon.16.png",
  "icons/icon.48.png",
  "icons/icon.128.png",
]) {
  assert.equal(await exists(relativePath), true, `Required source asset is missing: ${relativePath}`);
}

for (const obsoletePath of [
  "docs/upload-probe.tmp",
  "src/newtab/onboarding.ts",
  "src/newtab/instances.css",
  "src/newtab/editor.js",
  "src/newtab/ip.js",
  "src/newtab/instances.js",
  "src/options/options-helper.js",
  "src/options/background-presets.js",
  "src/lib/start-page-block-store.ts",
  "src/lib/start-page-theme-store.ts",
  "src/lib/start-page-settings-store.ts",
  "src/lib/start-page-validation-v2.ts",
  "src/lib/start-page-reset.ts",
  "src/lib/start-page-runtime-clock.ts",
  "src/lib/start-page-settings-themes.ts",
  "scripts/round7/harness.ts",
  "src/newtab/block-renderers.js",
  "src/newtab/block-renderers-v2.ts",
  "src/newtab/block-renderers-runtime-v2.js",
  "src/newtab/block-renderers-runtime-v2.ts",
  "src/newtab/block-renderers-runtime-v3.ts",
]) {
  assert.equal(await exists(obsoletePath), false, `Obsolete roadmap file must be removed: ${obsoletePath}`);
}

assert.match(rootBuild, /scripts\/build\.mjs/, "Root build entry must delegate to the canonical builder");
assert.match(canonicalBuild, /blockerOnly/, "Canonical builder must support blocker-only output");
assert.match(canonicalBuild, /if \(!blockerOnly\) entryPoints\.newtab/, "Blocker-only build must not bundle newtab");
assert.doesNotMatch(canonicalBuild, /instances\.js|editor\.js|options-helper\.js|background-presets\.js/, "Builder must not copy legacy helpers");
assert.doesNotMatch(newtabHtml, /newtab-onboarding|newtab-instances|newtab-editor|newtab-ip/, "New tab HTML must not load legacy helpers");
assert.doesNotMatch(optionsHtml, /options-helper|background-presets/, "Options HTML must not load legacy helpers");
assert.match(settingsSource, /isFutureStartPageSchema\(raw\)/, "Settings reads must protect unsupported future schemas");
assert.match(settingsSource, /blockContentEqual/, "Block timestamps must be based on content changes");
assert.doesNotMatch(settingsSource, /`\$\{source\.title\} copy`|`\$\{source\.name\} copy`/, "Persistence code must not hardcode an English duplicate suffix");
assert.match(runtimeRendererSource, /type:\s*["']complete-clock["']/, "The new-tab page must delegate clock completion to the service worker");
assert.match(runtimeRendererSource, /type:\s*["']clock-action["']/, "The new-tab page must delegate clock mutations to the service worker");
assert.doesNotMatch(runtimeRendererSource, /completeClockInstance|chrome\.notifications\.create|recordFocusSessionCompleted/, "The new-tab page must not own clock completion side effects");
for (const messageType of ["complete-clock", "clock-action", "reset-clocks", "runtime-note", "runtime-tasks", "runtime-link-page", "delete-instance-runtime", "replace-start-page-settings", "record-unblock", "reset-stats"]) {
  assert.ok(serviceWorkerSource.includes(`case "${messageType}"`) || serviceWorkerSource.includes(`type: "${messageType}"`), `Service worker must handle ${messageType}`);
}

for (const command of [
  "node scripts/validate-static.mjs",
  "node scripts/validate-round19-static.mjs",
  "node scripts/validate-self-hosted-ci.mjs",
  "npm run typecheck",
  "npm run build",
  "npm run build:blocker-only",
]) {
  assert.ok(ci.includes(command), `CI must execute ${command}`);
}
assertCiPolicy(ci);

const sourceFiles = (await walk(resolve(root, "src"))).filter((file) => /\.(?:ts|js|html)$/.test(file));
const moduleStems = new Map();
for (const file of sourceFiles.filter((item) => /\.(?:ts|js)$/.test(item))) {
  const stem = file.replace(/\.(?:ts|js)$/, "");
  const siblings = moduleStems.get(stem) ?? [];
  siblings.push(path.relative(root, file));
  moduleStems.set(stem, siblings);
}
for (const siblings of moduleStems.values()) {
  assert.equal(siblings.length, 1, `A JavaScript source file shadows a TypeScript module: ${siblings.join(", ")}`);
}
const literalMessageKeys = new Set();
for (const file of sourceFiles) {
  const source = await readFile(file, "utf8");
  assert.doesNotMatch(source, /\beval\s*\(/, `${path.relative(root, file)} must not use eval`);
  assert.doesNotMatch(source, /\bnew\s+Function\s*\(/, `${path.relative(root, file)} must not construct code dynamically`);
  assert.doesNotMatch(source, /\b(?:FIXME|HACK|XXX)\b/, `${path.relative(root, file)} contains unfinished markers`);
  if (file.startsWith(resolve(root, "src"))) {
    assert.doesNotMatch(source, /\bdebugger\b/, `${path.relative(root, file)} contains a debugger statement`);
    assert.doesNotMatch(source, /console\.log\s*\(/, `${path.relative(root, file)} contains debug logging`);
  }
  for (const match of source.matchAll(/\.t\(["']([^"']+)["']/g)) literalMessageKeys.add(match[1]);
}
for (const key of literalMessageKeys) assert.ok(effectiveEnMessages[key], `Missing English localization key used by source: ${key}`);

const temporary = await mkdtemp(path.join(tmpdir(), "start-tab-fixtures-"));
try {
  const outfile = path.join(temporary, "roadmap-fixtures.mjs");
  await build({
    entryPoints: [resolve(root, "scripts/roadmap-fixtures.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "silent",
  });
  await import(`${pathToFileURL(outfile).href}?run=${Date.now()}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log("Static and roadmap validation passed");
