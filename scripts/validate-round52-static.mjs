import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const revision = await readFile("src/lib/data-revision.ts", "utf8");
const backup = await readFile("src/lib/backup.ts", "utf8");
const chromeSync = await readFile("src/lib/chrome-sync.ts", "utf8");
const google = await readFile("src/lib/google-integration.ts", "utf8");
const options = await readFile("src/options/options.ts", "utf8");
const fixtures = await readFile("scripts/round52-fixtures.ts", "utf8");
const runner = await readFile("scripts/run-round52-fixtures.mjs", "utf8");
const workflow = await readFile(".github/workflows/ci.yml", "utf8");
const selfHosted = await readFile("scripts/validate-self-hosted-ci.mjs", "utf8");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const audit = await readFile("docs/audit-2026-08-11-round-52.md", "utf8");
const manualQa = await readFile("docs/manual-qa-round52.md", "utf8");

assert.match(revision, /export class StartTabDataRevisionConflictError extends Error/);
assert.match(revision, /export async function assertStartTabDataRevisionUnchanged/);
assert.match(revision, /const current = await readStartTabDataRevision\(fallback\)/);
assert.match(revision, /if \(current !== expected\) throw new StartTabDataRevisionConflictError/,
  "Revision CAS must reject an obsolete local snapshot");

assert.match(backup, /expectedCurrentDataRevision\?: number/);
assert.match(backup, /expectedCurrentDataRevisionFallback\?: number/);
assert.match(backup, /dataRevisionFallback: number/);
assert.match(backup, /const dataRevisionFallback = backupModifiedAt\(bundle\)/);
assert.match(backup, /return \{ bundle, dataRevision, dataRevisionFallback \}/);
const importLock = backup.indexOf('return withStorageLock("data-write"');
const importGuard = backup.indexOf("assertStartTabDataRevisionUnchanged(", importLock);
const recoveryWrite = backup.indexOf("PRE_IMPORT_BACKUP_KEY", importGuard);
assert.ok(importLock >= 0 && importGuard > importLock && recoveryWrite > importGuard,
  "Backup revision CAS must run under data-write before the recovery snapshot or any destructive import side effect");
assert.match(backup, /export async function importBackupAfterRead\([\s\S]*const localBeforeRead = await exportBackupSnapshot\(\)[\s\S]*const value = await readBackup\(\)[\s\S]*expectedCurrentDataRevision: localBeforeRead\.dataRevision/,
  "An asynchronous local backup read must capture revision before reading and CAS it at import");
assert.match(backup, /export async function restorePreImportBackup\(\)[\s\S]*importBackupAfterRead\(async \(\) =>[\s\S]*chrome\.storage\.local\.get\(PRE_IMPORT_BACKUP_KEY\)/,
  "Recovery restore must guard the interval between reading recovery data and destructive import");
assert.match(options, /importBackupAfterRead/);
assert.match(options, /confirmDataRestore\(\)[\s\S]*runAction\(async \(\) => \{[\s\S]*importBackupAfterRead\([\s\S]*\(\) => readJsonFile\(file\)/,
  "Local JSON Import must capture its CAS after confirmation but before File.text() is awaited");
assert.doesNotMatch(options, /importBackup\(await readJsonFile\(file\)\)/,
  "Options must not retain the unguarded local JSON import path");

assert.match(chromeSync, /const MAX_LOCAL_REVISION_RETRIES = 3/);
assert.match(chromeSync, /dataRevisionFallback: captured\.dataRevisionFallback/);
assert.match(chromeSync, /async function assertLocalRevisionGuard[\s\S]*withStorageLock\("data-write"/,
  "Non-destructive remote upload checks must observe revision under the data-write boundary");
assert.match(chromeSync, /async function retryLocalRevisionConflicts/);
assert.match(chromeSync, /error instanceof StartTabDataRevisionConflictError/);
assert.match(chromeSync,
  /assertLocalRevisionGuard\(guard, "Start Tab data changed before the Browser Sync upload could commit"\)[\s\S]*chrome\.storage\.sync\.set\(payload\)[\s\S]*assertLocalRevisionGuard\(guard, "Start Tab data changed while the Browser Sync upload was committing"\)/,
  "Browser Sync upload must verify the captured revision on both sides of its remote commit window");
assert.match(chromeSync, /async function restoreParsedSnapshot\(parsed: ParsedMeta, guard: LocalRevisionGuard\)/);
assert.match(chromeSync, /expectedCurrentDataRevision: guard\.dataRevision/);
assert.match(chromeSync, /expectedCurrentDataRevisionFallback: guard\.dataRevisionFallback/);
assert.match(chromeSync,
  /export async function restoreChromeSyncBackup\(\): Promise<void> \{\s*const guard = await captureLocalRevisionGuard\(\);\s*await withStorageLock\("chrome-sync", async \(\) => \{\s*await assertCompatibleSyncMetadata\(\);\s*await restoreChromeSyncBackupInTransaction\(guard\)/,
  "Explicit Browser Sync Restore must capture its local revision before waiting for the sync lock or performing remote metadata I/O");
assert.match(chromeSync, /return retryLocalRevisionConflicts\(syncChromeSyncBackupInTransaction\)/,
  "Smart Sync must recalculate its decision after a local revision conflict");
assert.match(chromeSync, /retryLocalRevisionConflicts\(uploadChromeSyncBackupInTransaction\)/,
  "Manual Browser Sync Upload must converge to a stable local snapshot before reporting success");
assert.match(chromeSync, /assertLocalRevisionGuard\(guard, "Start Tab data changed while Browser Sync was confirming matching content"\)/,
  "The unchanged result must also validate that the local snapshot used for the decision stayed current");

assert.match(google, /const localBeforeNetwork = await exportBackupSnapshot\(\)/);
assert.match(google, /expectedCurrentDataRevision: localBeforeNetwork\.dataRevision/);
assert.match(google, /expectedCurrentDataRevisionFallback: localBeforeNetwork\.dataRevisionFallback/,
  "Google Drive Restore must CAS the local revision captured before network I/O");

for (const marker of [
  "A stale backup CAS must reject before destructive import work",
  "Smart Sync must recalculate after a local revision conflict",
  "Browser Sync Upload must retry after local data changes during the remote commit",
  "Explicit Browser Sync Restore must fail closed if local data changes after confirmation",
  "Google Drive Restore must fail closed when local data changes during download",
]) {
  assert.ok(fixtures.includes(marker), `Round 52 fixture is missing: ${marker}`);
}
assert.match(fixtures, /keys !== "startTabSyncMeta"/,
  "Explicit Restore fixture must mutate local data on the first remote metadata read, not only during chunk download");
assert.match(runner, /entryPoints: \[path\.join\(root, "scripts", "round52-fixtures\.ts"\)\]/);
assert.match(runner, /target: "node22"/);

for (const command of [
  "node scripts/run-round52-fixtures.mjs",
  "node scripts/validate-round52-static.mjs",
]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test is missing ${command}`);
  assert.ok(workflow.includes(command), `CI is missing ${command}`);
  assert.ok(selfHosted.includes(command), `Self-hosted contract is missing ${command}`);
}
assert.ok(
  workflow.indexOf("node scripts/validate-round51-static.mjs")
    < workflow.indexOf("node scripts/run-round52-fixtures.mjs")
    && workflow.indexOf("node scripts/run-round52-fixtures.mjs")
      < workflow.indexOf("node scripts/validate-round52-static.mjs")
    && workflow.indexOf("node scripts/validate-round52-static.mjs")
      < workflow.indexOf("node scripts/validate-self-hosted-ci.mjs"),
  "Round 52 must run explicitly after Round 51 and before the central CI contract",
);

for (const phrase of ["lost update", "browser sync", "google drive", "local json", "recovery", "revision", "fail closed", "remote metadata", "retry"] ) {
  assert.ok(audit.toLowerCase().includes(phrase), `Round 52 audit is missing: ${phrase}`);
}
for (const phrase of ["browser sync", "google drive", "local json", "recovery", "another tab", "restore", "upload", "metadata"]) {
  assert.ok(manualQa.toLowerCase().includes(phrase), `Round 52 manual QA is missing: ${phrase}`);
}

console.log("Round 52 static validation passed");
