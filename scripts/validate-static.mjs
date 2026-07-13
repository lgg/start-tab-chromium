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
  if (ci.includes("actions/upload-artifact")) {
    assert.match(ci, /retention-days:\s*1\b/, "GitHub artifact uploads must use one-day retention");
  }
  assert.doesNotMatch(ci, /actions\/cache@/, "Explicit GitHub Actions caches are not expected");
}

const [manifest, packageJson, packageLock, enMessages, ruMessages, ci, rootBuild, canonicalBuild, newtabHtml, optionsHtml] = await Promise.all([
  readJson("src/manifest.json"),
  readJson("package.json"),
  readJson("package-lock.json"),
  readJson("src/_locales/en/messages.json"),
  readJson("src/_locales/ru/messages.json"),
  readFile(resolve(root, ".github/workflows/ci.yml"), "utf8"),
  readFile(resolve(root, "build.mjs"), "utf8"),
  readFile(resolve(root, "scripts/build.mjs"), "utf8"),
  readFile(resolve(root, "src/newtab/newtab.html"), "utf8"),
  readFile(resolve(root, "src/options/options.html"), "utf8"),
]);

assert.equal(manifest.manifest_version, 3, "Manifest must remain MV3");
assert.equal(manifest.version, packageJson.version, "Package and manifest versions must match");
assert.equal(packageLock.version, packageJson.version, "Package lock and package versions must match");
assert.equal(packageLock.packages?.[""]?.version, packageJson.version, "Root lock package version must match");
assert.equal(manifest.default_locale, "en");
assert.equal(manifest.background?.service_worker, "service-worker.js");
assert.equal(manifest.chrome_url_overrides?.newtab, "newtab.html");
for (const permission of ["storage", "alarms", "notifications", "declarativeNetRequest", "webNavigation"]) {
  assert.ok(manifest.permissions?.includes(permission), `Manifest permission ${permission} is required`);
}

assertCatalog("en", enMessages);
assertCatalog("ru", ruMessages);
assert.deepEqual(sortedKeys(ruMessages), sortedKeys(enMessages), "English and Russian catalogs must have identical keys");

for (const relativePath of [
  "src/_locales/en/messages.json",
  "src/_locales/ru/messages.json",
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
  "src/icons/icon.16.png",
  "src/icons/icon.48.png",
  "src/icons/icon.128.png",
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
]) {
  assert.equal(await exists(obsoletePath), false, `Obsolete roadmap file must be removed: ${obsoletePath}`);
}

assert.match(rootBuild, /scripts\/build\.mjs/, "Root build entry must delegate to the canonical builder");
assert.match(canonicalBuild, /blockerOnly/, "Canonical builder must support blocker-only output");
assert.match(canonicalBuild, /if \(!blockerOnly\) entryPoints\.newtab/, "Blocker-only build must not bundle newtab");
assert.doesNotMatch(canonicalBuild, /instances\.js|editor\.js|options-helper\.js|background-presets\.js/, "Builder must not copy legacy helpers");
assert.doesNotMatch(newtabHtml, /newtab-onboarding|newtab-instances|newtab-editor|newtab-ip/, "New tab HTML must not load legacy helpers");
assert.doesNotMatch(optionsHtml, /options-helper|background-presets/, "Options HTML must not load legacy helpers");

assert.match(ci, /npm run test/);
assert.match(ci, /npm run typecheck/);
assert.match(ci, /npm run build\b/);
assert.match(ci, /npm run build:blocker-only/);
assertCiPolicy(ci);

const sourceFiles = (await walk(resolve(root, "src"))).filter((file) => /\.(?:ts|js|html)$/.test(file));
const literalMessageKeys = new Set();
for (const file of sourceFiles) {
  const source = await readFile(file, "utf8");
  assert.doesNotMatch(source, /\beval\s*\(/, `${path.relative(root, file)} must not use eval`);
  assert.doesNotMatch(source, /\bnew\s+Function\s*\(/, `${path.relative(root, file)} must not construct code dynamically`);
  assert.doesNotMatch(source, /\b(?:TODO|FIXME|HACK|XXX)\b/, `${path.relative(root, file)} contains unfinished markers`);
  for (const match of source.matchAll(/\.t\(["']([^"']+)["']/g)) literalMessageKeys.add(match[1]);
}
for (const key of literalMessageKeys) assert.ok(enMessages[key], `Missing English localization key used by source: ${key}`);

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
