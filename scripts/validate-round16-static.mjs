import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const runtime = read("src/lib/start-page-runtime.ts");
const focus = read("src/lib/focus-stats.ts");
const worker = read("src/service-worker.ts");
const nativeTab = read("src/lib/native-new-tab.ts");
const blocklist = read("src/lib/blocklist.ts");
const backup = read("src/lib/backup.ts");
const messages = read("src/lib/messages.ts");
const limits = read("src/lib/platform-limits.ts");

assert.match(runtime, /export async function resetAllClockRuntimeWithAlarms[\s\S]*mutateStartPageRuntimeStateWithAlarms/,
  "Reset-all clocks must remain one recoverable runtime/alarm transaction");
assert.match(worker, /case "reset-clocks": await runRuntimeJob\(resetAllClocks\)/,
  "The complete reset-all command must be serialized as one runtime job");
assert.doesNotMatch(worker, /for \(const instanceId of clockIds\)/,
  "Reset-all must not regress to per-instance partial commits");
assert.match(runtime, /resetAllClockRuntimeWithAlarms[\s\S]*\[FOCUS_STATS_KEY\][\s\S]*applyFocusClockStatsPatchInExistingTransaction/,
  "Reset-all must record all interruption durations inside its atomic runtime transaction");
assert.match(focus, /export async function recordFocusSessionsInterrupted/,
  "Batch interruption accounting must remain available");
assert.match(worker, /consumeNativeNewTabBypass, openNativeNewTab/,
  "The worker must use the testable native-new-tab owner");
assert.doesNotMatch(worker, /url: "about:blank"/,
  "The worker must not reintroduce an unowned temporary native-tab path");
assert.match(nativeTab, /await chrome\.tabs\.remove\(tabId\)/,
  "Failed native-new-tab attempts must close their temporary tab");
assert.match(nativeTab, /removeOwnedBypass\(tabId\)/,
  "Failed native-new-tab attempts must clear only their owned bypass marker");

assert.match(limits, /MAX_BLOCKED_SITES = 5_000/,
  "Chrome redirect-rule capacity must remain explicit and centralized");
assert.match(blocklist, /assertBlockedSiteCapacity\(normalized\)/,
  "Bulk blocklist replacement and migration must enforce Chrome's unsafe dynamic-rule quota");
assert.match(blocklist, /assertBlockedSiteCapacity\(nextSites\)/,
  "Incremental blocklist mutations must reject overflow before storage or DNR writes");
assert.match(backup, /assertBlockedSiteCapacity\(normalized\)/,
  "Backup migration must reject an unenforceable oversized blocklist before import");
assert.match(messages, /value\.sites\.length <= MAX_BLOCKED_SITES/,
  "Service-worker message validation must reject oversized blocklist payloads");

console.log("Round 16 static validation passed");
