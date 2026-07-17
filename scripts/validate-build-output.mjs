import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = process.argv[2];
const variant = process.argv[3];
assert.ok(directory, "Build directory argument is required");
assert.ok(variant === "full" || variant === "blocker-only", "Variant must be full or blocker-only");
const outdir = path.resolve(root, directory);

async function exists(relativePath) {
  try {
    await access(path.join(outdir, relativePath));
    return true;
  } catch {
    return false;
  }
}

const manifest = JSON.parse(await readFile(path.join(outdir, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3, "Build manifest must remain Manifest V3");
assert.equal(manifest.version, "3.0.0", "Build manifest version must match release version");
assert.equal(manifest.background?.service_worker, "service-worker.js", "Service worker output must be wired");
const configuredGoogleClientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";
if (configuredGoogleClientId) {
  assert.match(configuredGoogleClientId, /^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/, "Configured Google OAuth client ID must use the expected Chrome client format");
  assert.equal(manifest.oauth2?.client_id, configuredGoogleClientId, "Configured Google OAuth client ID must reach the build manifest");
  assert.ok(manifest.permissions?.includes("identity"), "Google-enabled builds require the identity permission");
} else {
  assert.equal(manifest.oauth2, undefined, "Default deployable builds must not contain a placeholder OAuth client ID");
  assert.equal(manifest.permissions?.includes("identity"), false, "Google-disabled builds must omit the identity permission");
}

for (const file of [
  "service-worker.js",
  "popup.js",
  "popup.html",
  "popup.css",
  "blocked.js",
  "blocked.html",
  "blocked.css",
  "options.js",
  "options.html",
  "options.css",
  "shared-ui.css",
  "_locales/en/messages.json",
  "_locales/ru/messages.json",
  "icons/icon.16.png",
  "icons/icon.48.png",
  "icons/icon.128.png",
]) {
  assert.equal(await exists(file), true, `${variant} build is missing ${file}`);
}

if (variant === "full") {
  assert.equal(manifest.chrome_url_overrides?.newtab, "newtab.html", "Full build must own the new tab page");
  assert.ok(manifest.permissions?.includes("history"), "Full builds require history for the Recent History block");
  for (const file of ["newtab.js", "newtab.html", "newtab.css", "newtab-gate.js"]) {
    assert.equal(await exists(file), true, `Full build is missing ${file}`);
  }
  const newtabSource = await readFile(path.join(outdir, "newtab.js"), "utf8");
  for (const marker of ["complete-clock", "clock-action", "reset-clocks", "runtime-note", "runtime-tasks", "runtime-link-page", "replace-start-page-settings", "reset-stats"]) {
    assert.ok(newtabSource.includes(marker), `newtab.js must delegate ${marker} to the service worker`);
  }
  assert.doesNotMatch(newtabSource, /notifications\.create/, "newtab.js must not create clock notifications");
  const gateSource = await readFile(path.join(outdir, "newtab-gate.js"), "utf8");
  assert.ok(gateSource.includes("open-native-new-tab"), "newtab-gate.js must delegate native-tab creation");
  assert.doesNotMatch(gateSource, /startTabNativeNewTabBypass|chrome:\/\/new-tab-page|chrome-search:\/\/local-ntp/, "newtab-gate.js must not mutate bypass state or navigate tabs directly");
} else {
  assert.equal(manifest.chrome_url_overrides, undefined, "Blocker-only build must omit the new-tab override");
  assert.equal(manifest.permissions?.includes("history"), false, "Blocker-only build must omit the unused history permission");
  for (const file of ["newtab.js", "newtab.html", "newtab.css", "newtab-gate.js"]) {
    assert.equal(await exists(file), false, `Blocker-only build must not contain ${file}`);
  }
}

const serviceWorkerSource = await readFile(path.join(outdir, "service-worker.js"), "utf8");
for (const marker of ["complete-clock", "clock-action", "reset-clocks", "runtime-note", "runtime-tasks", "runtime-link-page", "delete-instance-runtime", "record-unblock", "reset-stats", "replace-blocked-sites", "open-native-new-tab", "reset-start-page", "replace-start-page-settings"]) {
  assert.ok(serviceWorkerSource.includes(marker), `service-worker.js must own ${marker}`);
}
assert.match(serviceWorkerSource, /notifications\.create/, "service-worker.js must own clock notifications");
assert.ok(serviceWorkerSource.includes("Opening the native new tab failed and cleanup of its temporary tab was incomplete"),
  "service-worker.js must include temporary native-tab cleanup");
assert.ok(serviceWorkerSource.includes("Start Tab supports at most"),
  "service-worker.js must enforce the Chrome DNR redirect-rule capacity");

for (const file of ["service-worker.js", "popup.js", "blocked.js", "options.js", ...(variant === "full" ? ["newtab.js"] : [])]) {
  const source = await readFile(path.join(outdir, file), "utf8");
  assert.doesNotMatch(source, /\beval\s*\(/, `${file} must not contain eval`);
  assert.doesNotMatch(source, /\bnew\s+Function\s*\(/, `${file} must not construct code dynamically`);
}

console.log(`${variant} build validation passed`);
