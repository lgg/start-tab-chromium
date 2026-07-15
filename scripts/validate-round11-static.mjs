import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [backupSource, googleSource, calendarRendererSource] = await Promise.all([
  readFile(resolve(root, "src/lib/backup.ts"), "utf8"),
  readFile(resolve(root, "src/lib/google-integration.ts"), "utf8"),
  readFile(resolve(root, "src/newtab/block-renderers-integrations.ts"), "utf8"),
]);

assert.match(backupSource, /LEGACY_BLOCKED_SITES_KEY\s*=\s*["']blocked["']/, "Backup migration must recognize the legacy blocked key");
assert.match(backupSource, /normalizeBackupBlockedSites/, "Backup export and migration must share legacy blocklist normalization");
assert.match(googleSource, /crypto\.randomUUID\(\)/, "Drive multipart uploads must use an unpredictable boundary");
assert.doesNotMatch(googleSource, /const boundary\s*=\s*["']start-tab-boundary["']/, "Drive multipart uploads must not use a fixed boundary");
assert.match(googleSource, /allDay:\s*Boolean\(/, "Calendar mapping must retain the Google all-day marker");
assert.match(calendarRendererSource, /event\.allDay/, "Calendar rendering must handle all-day events separately");

const temporary = await mkdtemp(path.join(tmpdir(), "start-tab-round11-"));
try {
  const outfile = path.join(temporary, "round11-fixtures.mjs");
  await build({
    entryPoints: [resolve(root, "scripts/round11-fixtures.ts")],
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

console.log("Round 11 static validation passed");
