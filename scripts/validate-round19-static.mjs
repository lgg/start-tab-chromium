import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const dictionary = read("src/lib/dictionary.ts");
const validation = read("src/lib/start-page-validation-primitives.ts");
const runtime = read("src/lib/start-page-runtime.ts");
const focusStats = read("src/lib/focus-stats.ts");
const blocklist = read("src/lib/blocklist.ts");
const serviceWorker = read("src/service-worker.ts");
const settings = read("src/lib/start-page-settings.ts");
const settingsValidation = read("src/lib/start-page-settings-validation.ts");
const renderRuntime = read("src/newtab/block-renderers-runtime.ts");
const renderStatic = read("src/newtab/block-renderers-static.ts");
const backup = read("src/lib/backup.ts");
const backupBlockedUrls = read("src/lib/backup-blocked-urls.ts");

assert.match(dictionary, /Object\.create\(null\)/,
  "User-keyed dictionaries must have no inherited prototype names");
assert.match(dictionary, /Object\.prototype\.hasOwnProperty\.call/,
  "User-keyed reads must be restricted to own properties");
assert.match(dictionary, /export function cloneDictionary[\s\S]*createDictionary<T>\(\)/,
  "Mutation clones must preserve prototype-free dictionary targets");
assert.match(validation, /createDictionary<number>\(\)/,
  "Per-domain focus estimates must normalize into a prototype-free dictionary");
assert.match(runtime, /createDictionary<ClockRuntimeState>\(\)[\s\S]*createDictionary<string>\(\)[\s\S]*createDictionary<LocalTask\[\]>\(\)[\s\S]*createDictionary<number>\(\)/,
  "All per-instance runtime collections must use prototype-free dictionaries");
assert.match(runtime, /ownValue\(sourceClocks, block\.id\)/,
  "Runtime normalization must not read inherited values for block IDs");
assert.match(runtime, /cloneRuntimeStateForMutation[\s\S]*cloneDictionary\(state\.notes\)/,
  "Runtime mutations must not downgrade prototype-free dictionaries through structuredClone");
assert.match(focusStats, /byDomain: createDictionary<DomainStats>\(\)/,
  "Focus domain statistics must use prototype-free dictionaries");
assert.match(focusStats, /ownValue\(stats\.byDomain, host\)/,
  "Focus domain lookup must ignore inherited names");
assert.match(blocklist, /normalizeLastBlockedUrls[\s\S]*createDictionary<string>\(\)/,
  "Last blocked URLs must use a prototype-free dictionary");
assert.match(blocklist, /ownValue\(urls, normalized\)/,
  "Last blocked URL reads must ignore inherited names");
for (const [source, label] of [
  [serviceWorker, "service-worker runtime messages"],
  [settings, "settings replacement"],
  [settingsValidation, "settings user-data checks"],
  [renderRuntime, "dynamic block renderers"],
  [renderStatic, "static block renderers"],
]) {
  assert.match(source, /ownValue\(/, `${label} must use own-property reads for user-controlled block IDs`);
}
assert.match(backupBlockedUrls, /export type BackupCollectionMode = "strict-import" \| "local-recovery"/,
  "Backup normalization must distinguish untrusted imports from local recovery");
assert.match(backup, /mode === "strict-import"\) assertCollectionCapacity\(source\)/,
  "Untrusted backup collections must remain strictly rejected before normalization");
assert.match(backup, /normalizeBackupBlockedSites\(source, mode\)/,
  "Blocked-site capacity must follow the same strict-import/local-recovery mode");
assert.match(backup, /normalizedStorage\(snapshot, "local-recovery"\)/,
  "Export must remain available for bounded recovery of corrupted local state");
assert.match(backup, /normalizedStorage\(current, "local-recovery"\)/,
  "Pre-import recovery must remain available for corrupted local state");
assert.match(backup, /export function migrateBackup[\s\S]*normalizedStorage\(value\.storage\)/,
  "External backup migration must keep the strict mode as its default");

console.log("Round 19 static validation passed");
