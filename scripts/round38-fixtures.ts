import assert from "node:assert/strict";
import { hashTargetsSection } from "../src/options/deferred-section.js";
import {
  assertRuntimeMutationTarget,
  runtimeMutationTargetExists,
} from "../src/lib/runtime-mutation-target.js";
import { nextSettingsDialogTitleId } from "../src/lib/settings-dialog-guard.js";
import {
  createBlockInstance,
  createDefaultStartPageSettings,
} from "../src/lib/start-page-settings.js";

const settings = createDefaultStartPageSettings(1);
const note = createBlockInstance("note", { id: "note-a" });
const tasks = createBlockInstance("localTasks", { id: "tasks-a" });
const links = createBlockInstance("links", { id: "links-a" });
const pinned = createBlockInstance("startPinned", { id: "pinned-a" });
const timer = createBlockInstance("timer", { id: "timer-a" });
settings.layout.blocks = [note, tasks, links, pinned, timer];

assert.equal(runtimeMutationTargetExists(settings, note.id, "note"), true);
assert.equal(runtimeMutationTargetExists(settings, tasks.id, "tasks"), true);
assert.equal(runtimeMutationTargetExists(settings, links.id, "linkPage"), true);
assert.equal(runtimeMutationTargetExists(settings, pinned.id, "linkPage"), true);
assert.equal(runtimeMutationTargetExists(settings, timer.id, "note"), false);
assert.equal(runtimeMutationTargetExists(settings, "removed", "tasks"), false);
assert.throws(
  () => assertRuntimeMutationTarget(settings, timer.id, "note"),
  /changed or was removed/,
  "A runtime mutation must reject an instance whose block type changed",
);
assert.throws(
  () => assertRuntimeMutationTarget(settings, "removed", "linkPage"),
  /changed or was removed/,
  "A runtime mutation must reject a removed block instead of acknowledging a no-op",
);

assert.equal(hashTargetsSection("#statistics", "statistics"), true);
assert.equal(hashTargetsSection("#stat%69stics", "statistics"), true);
assert.equal(hashTargetsSection("#blocks", "statistics"), false);
assert.equal(hashTargetsSection("statistics", "statistics"), false);
assert.equal(hashTargetsSection("#%E0%A4%A", "%E0%A4%A"), true,
  "Malformed escape sequences must fall back to literal hash matching");

const firstDialogTitle = nextSettingsDialogTitleId("settings-title");
const secondDialogTitle = nextSettingsDialogTitleId("settings-title");
assert.notEqual(firstDialogTitle, secondDialogTitle, "Settings dialog title IDs must remain unique across rapid reopen attempts");
assert.match(firstDialogTitle, /^settings-title-\d+-\d+$/);

console.log("Round 38 fixtures passed");
