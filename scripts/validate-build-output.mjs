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
  for (const file of ["newtab.js", "newtab.html", "newtab.css", "newtab-gate.js"]) {
    assert.equal(await exists(file), true, `Full build is missing ${file}`);
  }
  const newtabSource = await readFile(path.join(outdir, "newtab.js"), "utf8");
  for (const marker of ["complete-clock", "clock-action", "reset-clocks", "runtime-note", "runtime-tasks", "runtime-link-page", "delete-instance-runtime", "reset-stats"]) {
    assert.ok(newtabSource.includes(marker), `newtab.js must delegate ${marker} to the service worker`);
  }
  assert.doesNotMatch(newtabSource, /notifications\.create/, "newtab.js must not create clock notifications");
} else {
  assert.equal(manifest.chrome_url_overrides, undefined, "Blocker-only build must omit the new-tab override");
  for (const file of ["newtab.js", "newtab.html", "newtab.css", "newtab-gate.js"]) {
    assert.equal(await exists(file), false, `Blocker-only build must not contain ${file}`);
  }
}

const serviceWorkerSource = await readFile(path.join(outdir, "service-worker.js"), "utf8");
for (const marker of ["complete-clock", "clock-action", "reset-clocks", "runtime-note", "runtime-tasks", "runtime-link-page", "delete-instance-runtime", "record-unblock", "reset-stats"]) {
  assert.ok(serviceWorkerSource.includes(marker), `service-worker.js must own ${marker}`);
}
assert.match(serviceWorkerSource, /notifications\.create/, "service-worker.js must own clock notifications");

for (const file of ["service-worker.js", "popup.js", "blocked.js", "options.js", ...(variant === "full" ? ["newtab.js"] : [])]) {
  const source = await readFile(path.join(outdir, file), "utf8");
  assert.doesNotMatch(source, /\beval\s*\(/, `${file} must not contain eval`);
  assert.doesNotMatch(source, /\bnew\s+Function\s*\(/, `${file} must not construct code dynamically`);
}

console.log(`${variant} build validation passed`);
