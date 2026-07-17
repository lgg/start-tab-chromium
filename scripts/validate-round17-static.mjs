import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const runtime = read("src/lib/start-page-runtime.ts");
const focus = read("src/lib/focus-stats.ts");
const worker = read("src/service-worker.ts");

assert.match(runtime, /export function pomodoroFocusElapsedMs[\s\S]*Math\.min\(now, clock\.targetAt\)/,
  "Pomodoro focus accounting must cap delayed completion and reset at the phase deadline");
assert.match(runtime, /mutateStartPageRuntimeStateWithAlarmsAndStorageEffect[\s\S]*restoreStorageKeysSnapshot[\s\S]*restoreClockAlarmSnapshot/,
  "Clock state, related storage effects, revision, and alarms must share exact rollback");
assert.match(runtime, /completeClockInstance[\s\S]*\[FOCUS_STATS_KEY\][\s\S]*applyFocusClockStatsPatchInExistingTransaction/,
  "Clock completion and focus statistics must commit in one recoverable transaction");
assert.match(runtime, /startedWork: block\.type === "pomodoro" && next\.running && next\.phase === "work"/,
  "Break-to-work auto-start must be exposed to focus statistics");
assert.match(runtime, /resetAllClockRuntimeWithAlarms[\s\S]*pomodoroFocusElapsedMs[\s\S]*\[FOCUS_STATS_KEY\]/,
  "Reset-all clock state and interruption statistics must remain atomic and deadline-capped");
assert.match(worker, /performClockAction[\s\S]*mutateStartPageRuntimeStateWithAlarmsAndStorageEffect[\s\S]*\[FOCUS_STATS_KEY\]/,
  "Interactive clock actions and their statistics must share one transaction");
assert.doesNotMatch(worker, /outcome\.startedWork\) await runStatsJob|outcome\.interruptedMs > 0\) await runStatsJob/,
  "Clock actions must not report failure after committing runtime but before separate statistics");
assert.doesNotMatch(worker, /recordFocusSessionCompleted\(result\.focusTimeMs/,
  "Completion statistics must not remain a post-commit secondary effect");
assert.match(focus, /writes no separate data revision[\s\S]*applyFocusClockStatsPatchInExistingTransaction/,
  "The focus-stat companion write must explicitly belong to the surrounding data transaction");
assert.match(focus, /startedSessions[\s\S]*focusSessionsStarted/,
  "Focus-stat transition patches must count automatically started work sessions");
assert.match(runtime, /if \(!result\.completed \|\| \(!result\.startedWork && result\.focusTimeMs <= 0\)\) return/,
  "Non-Pomodoro completion must not touch or reject an unrelated future focus-statistics schema");
assert.match(worker, /if \(!outcome \|\| \(!outcome\.startedWork && outcome\.interruptedMs <= 0\)\) return/,
  "Timer and Stopwatch actions must not touch unrelated focus statistics");

console.log("Round 17 static validation passed");
