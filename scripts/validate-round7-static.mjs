import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");
const [storageLock, settings, runtime, backup, sync, blocklist, messages, serviceWorker, options, runtimeRenderers, staticRenderers, builder, buildValidator] = await Promise.all([
  read("src/lib/storage-lock.ts"),
  read("src/lib/start-page-settings.ts"),
  read("src/lib/start-page-runtime.ts"),
  read("src/lib/backup.ts"),
  read("src/lib/chrome-sync.ts"),
  read("src/lib/blocklist.ts"),
  read("src/lib/messages.ts"),
  read("src/service-worker.ts"),
  read("src/options/options.ts"),
  read("src/newtab/block-renderers-runtime.ts"),
  read("src/newtab/block-renderers-static.ts"),
  read("scripts/build.mjs"),
  read("scripts/validate-build-output.mjs"),
]);

assert.match(storageLock, /navigator\.locks|navigator\?\.locks|navigator.*locks/s, "Storage transactions must use cross-context Web Locks when available");
for (const [name, source] of [["settings", settings], ["runtime", runtime], ["backup", backup], ["blocklist", blocklist]]) {
  assert.match(source, /withStorageLock\(["']data-write["']/, `${name} must use the shared data-write lock`);
}
assert.match(settings, /value\.updatedAt !== previous\.updatedAt/, "Settings must reject zero-timestamp stale snapshots");
assert.match(runtime, /currentUpdatedAt !== expectedUpdatedAt/, "Runtime must reject zero-timestamp stale snapshots");
assert.match(runtime, /resetStartPageData/, "Complete Start Tab reset must be centralized");
assert.match(runtime, /ONBOARDING_KEY/, "Complete Start Tab reset must clear onboarding state");
assert.match(runtime, /absentResetKeys/, "Complete Start Tab reset must preserve exact key absence during rollback");
assert.match(runtime, /reconcileClockAlarmsForRuntime/, "Complete Start Tab reset must restore durable alarms on rollback");
assert.match(runtime, /AggregateError/, "Complete Start Tab reset must report incomplete rollback");
assert.match(backup, /ROLLBACK_KEYS/, "Backup rollback must preserve the prior recovery backup");
assert.match(backup, /AggregateError/, "Backup import must report incomplete rollback");
assert.match(sync, /dataRevisionAt: parsed\.meta\.contentUpdatedAt/, "Chrome Sync restore must advance revision exactly through backup import");
assert.doesNotMatch(sync, /importBackup\(bundle\);\s*await markStartTabDataChanged/, "Chrome Sync restore must not double-increment data revision");
assert.match(blocklist, /applyBlocklistMutation/, "Blocklist writes must use transactional storage/DNR updates");
assert.match(blocklist, /restoreBlocklistStorage/, "Blocklist DNR failures must restore storage");
for (const marker of ["expectedValue", "expectedTasks", "expectedPage"]) {
  assert.ok(messages.includes(marker), `Message validation must include ${marker}`);
  assert.ok(serviceWorker.includes(marker), `Service worker must enforce ${marker}`);
}
assert.match(runtimeRenderers, /expectedValue/, "Note writes must send their previous value");
assert.match(runtimeRenderers, /expectedTasks/, "Task writes must send their previous list");
assert.match(staticRenderers, /expectedPage/, "Link page writes must send their previous page");
assert.match(options, /type:\s*["']reset-start-page["']/, "Options reset must delegate to the service worker");
assert.doesNotMatch(options, /chrome\.storage\.local\.(?:set|remove|clear)/, "Options must not bypass locked persistence APIs");
assert.match(builder, /GOOGLE_OAUTH_CLIENT_ID/, "Builder must accept deployment OAuth configuration");
assert.match(builder, /delete manifest\.oauth2/, "Default builds must remove the placeholder OAuth block");
assert.match(builder, /permission !== ["']identity["']/, "Default builds must remove the unused identity permission");
assert.match(buildValidator, /Google-disabled builds must omit the identity permission/, "Build validation must enforce deployable Google-disabled manifests");

const temporary = await mkdtemp(path.join(tmpdir(), "start-tab-round7-"));
try {
  const outfile = path.join(temporary, "round7-fixtures.mjs");
  await build({
    entryPoints: [path.join(root, "scripts/round7-fixtures.ts")],
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

console.log("Round 7 static validation passed");
