import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");
const [storageLock, dataRevision, settings, runtime, backup, sync, blocklist, focusStats, i18n, messages, serviceWorker, newtab, options, runtimeRenderers, staticRenderers, builder, buildValidator] = await Promise.all([
  read("src/lib/storage-lock.ts"),
  read("src/lib/data-revision.ts"),
  read("src/lib/start-page-settings.ts"),
  read("src/lib/start-page-runtime.ts"),
  read("src/lib/backup.ts"),
  read("src/lib/chrome-sync.ts"),
  read("src/lib/blocklist.ts"),
  read("src/lib/focus-stats.ts"),
  read("src/lib/i18n.ts"),
  read("src/lib/messages.ts"),
  read("src/service-worker.ts"),
  read("src/newtab/newtab.ts"),
  read("src/options/options.ts"),
  read("src/newtab/block-renderers-runtime.ts"),
  read("src/newtab/block-renderers-static.ts"),
  read("scripts/build.mjs"),
  read("scripts/validate-build-output.mjs"),
]);

assert.match(storageLock, /navigator\.locks|navigator\?\.locks|navigator.*locks/s, "Storage transactions must use cross-context Web Locks when available");
assert.match(dataRevision, /isFutureDataRevisionSchema/, "Data revision metadata must detect unsupported future schemas");
assert.match(dataRevision, /commitStorageMutationWithRevision/, "Simple storage writes must share an exact revision rollback helper");
assert.match(dataRevision, /restoreExactStorageSnapshot/, "Revisioned storage mutations must restore exact key presence on failure");
for (const [name, source] of [["settings", settings], ["runtime", runtime], ["focus statistics", focusStats], ["blocklist side data", blocklist], ["locale", i18n], ["onboarding", newtab]]) {
  assert.match(source, /commitStorageMutationWithRevision/, `${name} writes must roll back if revision persistence fails`);
}
for (const [name, source] of [["settings", settings], ["runtime", runtime], ["backup", backup], ["blocklist", blocklist]]) {
  assert.match(source, /withStorageLock\(["']data-write["']/, `${name} must use the shared data-write lock`);
}
assert.match(settings, /value\.updatedAt !== previous\.updatedAt/, "Settings must reject zero-timestamp stale snapshots");
assert.match(runtime, /currentUpdatedAt !== expectedUpdatedAt/, "Runtime must reject zero-timestamp stale snapshots");
assert.match(runtime, /readRuntimeSettingsSnapshot\(true\)/, "Runtime writes must reject unsupported future settings schemas");
assert.match(runtime, /reconcileStoredClockAlarms[\s\S]*isFutureStartPageSchema[\s\S]*isFutureRuntimeSchema[\s\S]*return/, "Stored alarm reconciliation must not touch unsupported future schemas");
assert.match(runtime, /scheduleClockAlarm[\s\S]*withStorageLock\(["']data-write["']/, "Per-instance alarm scheduling must re-read current runtime under the data-write lock");
assert.match(runtime, /resetStartPageData/, "Complete Start Tab reset must be centralized");
assert.match(runtime, /ONBOARDING_KEY/, "Complete Start Tab reset must clear onboarding state");
assert.match(runtime, /restoreStorageKeysSnapshot/, "Runtime and complete Start Tab reset must preserve exact key absence during rollback");
assert.match(runtime, /readClockAlarmSnapshot/, "Complete Start Tab reset must capture durable alarms before mutation");
assert.match(runtime, /restoreClockAlarmSnapshot/, "Complete Start Tab reset must restore exact durable alarm metadata on rollback");
assert.match(runtime, /legacyClockToken/, "Running legacy countdowns must receive deterministic completion tokens");
assert.match(runtime, /rawRuntimeHasInstance/, "Instance deletion must remove orphaned raw runtime after settings deletion");
assert.match(runtime, /deleteInstanceRuntime[\s\S]*withStorageLock\(["\']data-write["\']/, "Instance runtime deletion must keep storage and alarm cleanup under one lock");
assert.match(runtime, /stableTaskHash/, "Legacy task identifiers must be deterministic");
assert.match(serviceWorker, /completeClockInstance[\s\S]*scheduleClockAlarm/, "Clock completion must schedule an auto-started next phase");
assert.match(runtime, /allowFutureOverwrite:\s*true/, "Explicit complete reset must be able to replace future revision metadata safely");
assert.match(runtime, /AggregateError/, "Complete Start Tab reset must report incomplete rollback");
assert.match(backup, /ROLLBACK_KEYS/, "Backup rollback must preserve the prior recovery backup");
assert.match(backup, /exportBackupSnapshot/, "Backup content and sync revision must be captured atomically");
assert.match(backup, /readStartTabDataRevision/, "Atomic backup snapshots must capture their data revision inside the data-write lock");
assert.doesNotMatch(backup, /Date\.parse\(bundle\.exportedAt\)/, "Backup export time must not be treated as content modification time");
assert.match(backup, /DATA_REVISION_KEY/, "Backup rollback must restore the previous data revision");
assert.match(backup, /readClockAlarmSnapshot/, "Backup import must snapshot durable alarms before applying data");
assert.match(backup, /reconcileClockAlarmsForRuntime/, "Backup import must reconcile active countdown alarms");
assert.match(backup, /restoreClockAlarmSnapshot/, "Backup rollback must restore exact prior alarms");
assert.match(backup, /AggregateError/, "Backup import must report incomplete rollback");
assert.match(backup, /isFutureFocusStatsSchema/, "Backup operations must preserve unsupported future statistics schemas");
assert.match(focusStats, /isFutureFocusStatsSchema/, "Focus statistics must detect unsupported future schemas");
assert.match(focusStats, /readStats\(true\)/, "Background focus-statistics mutations must reject unsupported future schemas");
assert.match(sync, /withStorageLock\(["']chrome-sync["']/, "Chrome Sync decisions and writes must be serialized across extension contexts");
assert.match(sync, /exportBackupSnapshot/, "Chrome Sync must use one atomic content-and-revision snapshot");
assert.doesNotMatch(sync, /readStartTabDataRevision/, "Chrome Sync must not read a revision after releasing the backup snapshot lock");
assert.match(sync, /isFutureSyncMeta/, "Chrome Sync must detect metadata written by a newer extension version");
assert.match(sync, /backupVersion > BACKUP_VERSION/, "Chrome Sync must protect future backup schemas even when the sync protocol version is unchanged");
assert.match(sync, /syncMetaEqual/, "Chrome Sync restore and upload must verify that remote metadata did not change mid-transaction");
assert.match(sync, /changed concurrently/, "Chrome Sync must fail closed when another device replaces a snapshot during transfer");
assert.match(sync, /assertCompatibleSyncMetadata/, "Every public Chrome Sync mutation must guard remote and local future metadata");
assert.match(sync, /dataRevisionAt: parsed\.meta\.contentUpdatedAt/, "Chrome Sync restore must advance revision exactly through backup import");
assert.doesNotMatch(sync, /importBackup\(bundle\);\s*await markStartTabDataChanged/, "Chrome Sync restore must not double-increment data revision");
assert.match(blocklist, /applyBlocklistMutation/, "Blocklist writes must use transactional storage/DNR updates");
assert.match(blocklist, /restoreBlocklistStorage/, "Blocklist DNR failures must restore storage");
assert.match(blocklist, /DATA_REVISION_KEY/, "Blocklist rollback must restore the previous data revision");
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
