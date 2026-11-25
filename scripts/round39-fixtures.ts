import assert from "node:assert/strict";
import { LayoutDraftVersion, clampFreeGeometry } from "../src/newtab/layout-draft-version.js";
import { MAX_FREE_GEOMETRY } from "../src/lib/platform-limits.js";
import { normalizeStartPageSettings } from "../src/lib/start-page-settings.js";
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

const baseline = new LayoutDraftVersion(100);
const dialogEpoch = baseline.epoch;
baseline.change();
assert.equal(baseline.updatedAt, 100, "Local draft edits must not advance the persisted CAS baseline");
assert.equal(baseline.isCurrent(dialogEpoch), false, "A local mutation invalidates a stale dialog result");
const epochBeforeReset = baseline.epoch;
baseline.reset(200);
assert.equal(baseline.updatedAt, 200);
assert.equal(baseline.isCurrent(epochBeforeReset), false, "A new edit session invalidates old dialogs even if a block still exists");
const oversized = createBlockInstance("note", { free: { x: MAX_FREE_GEOMETRY + 1, y: -4, width: Number.POSITIVE_INFINITY, height: MAX_FREE_GEOMETRY + 99 } });
const bounded = clampFreeGeometry(oversized);
assert.deepEqual(bounded.free, { x: MAX_FREE_GEOMETRY, y: 0, width: 250, height: MAX_FREE_GEOMETRY });
const freeSettings = createDefaultStartPageSettings(1);
freeSettings.layout.mode = "free";
freeSettings.layout.blocks = [bounded];
assert.deepEqual(normalizeStartPageSettings(freeSettings).layout.blocks[0]?.free, bounded.free, "Editor preview and persistence must use identical geometry bounds");
console.log("Round 59 layout version and geometry regressions passed");

const { chooseAcknowledgedSettings, pointerDraftChanged } = await import("../src/newtab/layout-draft-version.js");
const observed81 = createDefaultStartPageSettings(100);
const acknowledged81 = createDefaultStartPageSettings(200);
assert.equal(chooseAcknowledgedSettings(observed81, acknowledged81), acknowledged81);
assert.equal(chooseAcknowledgedSettings(acknowledged81, observed81), acknowledged81, "An older acknowledgement cannot overwrite a newer committed observation");
assert.equal(chooseAcknowledgedSettings(observed81), observed81, "Legacy acknowledgement fallback retains the last observed canonical settings");
const gesture81 = createBlockInstance("note");
assert.equal(pointerDraftChanged(gesture81, structuredClone(gesture81)), false);
assert.equal(pointerDraftChanged(gesture81, { ...gesture81, free: { ...gesture81.free, x: gesture81.free.x + 20 } }), true);
assert.equal(pointerDraftChanged(gesture81, undefined), true);
console.log("Round 81 acknowledgement and no-op gesture regressions passed");
