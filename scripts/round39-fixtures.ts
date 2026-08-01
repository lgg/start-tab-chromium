import assert from "node:assert/strict";
import { shouldRefreshLayoutDraft } from "../src/newtab/layout-editor.js";
import {
  assertRuntimeMutationTarget,
  runtimeMutationTargetExists,
} from "../src/lib/runtime-mutation-target.js";
import {
  createBlockInstance,
  createDefaultStartPageSettings,
} from "../src/lib/start-page-settings.js";

const targetSettings = createDefaultStartPageSettings(1);
const timerTarget = createBlockInstance("timer", { id: "timer-target" });
const stopwatchTarget = createBlockInstance("stopwatch", { id: "stopwatch-target" });
const pomodoroTarget = createBlockInstance("pomodoro", { id: "pomodoro-target" });
const noteTarget = createBlockInstance("note", { id: "note-target" });
targetSettings.layout.blocks = [timerTarget, stopwatchTarget, pomodoroTarget, noteTarget];

for (const block of [timerTarget, stopwatchTarget, pomodoroTarget]) {
  assert.equal(runtimeMutationTargetExists(targetSettings, block.id, "clock"), true,
    `${block.type} must be accepted as a current clock target`);
}
assert.equal(runtimeMutationTargetExists(targetSettings, noteTarget.id, "clock"), false);
assert.equal(runtimeMutationTargetExists(targetSettings, "removed-clock", "clock"), false);
assert.throws(
  () => assertRuntimeMutationTarget(targetSettings, noteTarget.id, "clock"),
  /changed or was removed/,
  "A clock action must reject an instance whose type changed",
);

assert.equal(shouldRefreshLayoutDraft(false, false, false), true,
  "An inactive editor must always follow the latest saved settings");
assert.equal(shouldRefreshLayoutDraft(true, false, false), true,
  "A clean active editor must refresh its draft when settings change externally");
assert.equal(shouldRefreshLayoutDraft(true, true, false), false,
  "A dirty active editor must preserve its local draft for conflict handling");
assert.equal(shouldRefreshLayoutDraft(true, false, true), false,
  "An in-flight save must keep its exact submitted draft stable");

console.log("Round 39 fixtures passed");
