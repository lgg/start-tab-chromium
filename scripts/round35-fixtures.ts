import assert from "node:assert/strict";
import { normalizeBackupLastBlockedUrls } from "../src/lib/backup-blocked-urls.js";
import { canonicalJsonValue, jsonContentEqual } from "../src/lib/json-content.js";
import {
  blockTitleKey,
  blockUsesDefaultTitle,
  createBlockInstanceDraft,
  createDefaultStartPageSettings,
  type StartPageRuntimeState,
} from "../src/lib/start-page-settings.js";
import { sameRuntimeContent } from "../src/newtab/storage-change-plan.js";

const left = {
  z: 1,
  nested: { beta: 2, alpha: 1 },
  list: [{ y: 2, x: 1 }],
};
const right = {
  list: [{ x: 1, y: 2 }],
  nested: { alpha: 1, beta: 2 },
  z: 1,
};
assert.equal(jsonContentEqual(left, right), true,
  "Object insertion order at every nesting level must not change JSON content equality");
assert.equal(jsonContentEqual([1, 2], [2, 1]), false,
  "Array order is user data and must remain significant");
assert.deepEqual(canonicalJsonValue({ z: 1, a: { y: 2, x: 1 } }), { a: { x: 1, y: 2 }, z: 1 });

const runtime = (updatedAt: number, reverse: boolean): StartPageRuntimeState => ({
  version: 2,
  updatedAt,
  clocks: {
    timer: reverse
      ? { completionToken: null, accumulatedMs: 0, startedAt: null, running: false, phase: "work", durationMs: 60_000 }
      : { durationMs: 60_000, phase: "work", running: false, startedAt: null, accumulatedMs: 0, completionToken: null },
  },
  notes: {},
  tasks: {
    tasks: reverse
      ? [{ completed: false, title: "One", id: "1" }]
      : [{ id: "1", title: "One", completed: false }],
  },
  linkPages: {},
});
assert.equal(sameRuntimeContent(runtime(1, false), runtime(2, true)), true,
  "Nested clock/task key order must not trigger a Start Tab rebuild");
const changed = runtime(3, true);
changed.tasks.tasks[0]!.completed = true;
assert.equal(sameRuntimeContent(runtime(1, false), changed), false,
  "Real nested runtime changes must still trigger a refresh");

const settings = createDefaultStartPageSettings(1);
const before = settings.layout.blocks.length;
const draft = createBlockInstanceDraft(settings, "note");
assert.equal(settings.layout.blocks.length, before,
  "Creating a block draft must not persist or mutate settings before dialog confirmation");
assert.equal(draft.title, blockTitleKey("note"));
assert.equal(blockUsesDefaultTitle(draft), true);
assert.equal(blockUsesDefaultTitle({ type: "note", title: "blockTitle custom note" }), false,
  "A legitimate custom title beginning with blockTitle must not be mistaken for an internal locale key");

const bounded = normalizeBackupLastBlockedUrls({
  "z.example": "https://z.example/path",
  "a.example": "https://a.example/path",
}, ["z.example", "a.example"], "local-recovery");
assert.deepEqual(Object.keys(bounded), ["a.example", "z.example"],
  "Local backup recovery ordering must be deterministic and locale-independent");

console.log("Round 35 fixtures passed");
