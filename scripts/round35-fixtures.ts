import assert from "node:assert/strict";
import { GeneralFormDraft } from "../src/options/general-form-draft.js";
import { ClockRequestGate } from "../src/newtab/clock-request-gate.js";
import { TaskSubmissionGate, TaskFormSessions } from "../src/newtab/task-submission-gate.js";
import { WidgetTextDrafts } from "../src/newtab/widget-text-drafts.js";
import { remainingCountdownSeconds } from "../src/blocked/countdown.js";
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

let tick = 0;
const requests = new ClockRequestGate(() => tick, 1_000);
const first = requests.begin("clock", "token-a");
assert.ok(first);
assert.equal(requests.isPending("clock"), true);
assert.equal(requests.begin("clock"), null, "Manual actions cannot overlap completion or its refresh");
assert.equal(requests.begin("clock", "token-a"), null, "A rebuilt renderer cannot duplicate an outstanding completion");
const independent = requests.begin("second");
assert.ok(independent);
requests.finish(independent);
requests.finish(first);
assert.equal(requests.isPending("clock"), false);
assert.equal(requests.canComplete("clock", "token-a"), false, "Failed/stale completion must not retry synchronously");
tick = 999;
assert.equal(requests.canComplete("clock", "token-a"), false);
const manual = requests.begin("clock");
assert.ok(manual, "Retry cooldown must not disable manual actions");
requests.finish(first); // Old callback must not clear the newer lease.
assert.equal(requests.isPending("clock"), true);
requests.finish(manual);
assert.equal(requests.canComplete("clock", "token-b"), true, "A new completion token is independent of the old cooldown");
tick = 1000;
assert.equal(requests.canComplete("clock", "token-a"), true, "The same token can retry after a bounded delay");
const retry = requests.begin("clock", "token-a");
assert.ok(retry);
tick = 2000;
requests.finish(retry);
assert.equal(requests.canComplete("clock", "token-a"), false, "Cooldown begins after the action and refresh settle");

const deadline = 10_000;
assert.equal(remainingCountdownSeconds(deadline, 0), 10);
assert.equal(remainingCountdownSeconds(deadline, 1), 10);
assert.equal(remainingCountdownSeconds(deadline, 9_999), 1, "Do not unblock before the full waiting time");
assert.equal(remainingCountdownSeconds(deadline, 10_000), 0);
assert.equal(remainingCountdownSeconds(deadline, 18_000), 0, "Throttled callbacks must not add another ten seconds");
console.log("Round 57 clock request and countdown regressions passed");

const submissions = new TaskSubmissionGate();
assert.equal(submissions.begin(), true);
assert.equal(submissions.pending, true);
assert.equal(submissions.begin(), false, "A second submit while the first task is pending must not create a duplicate");
assert.equal(submissions.afterSuccess("next task", "first task"), "next task", "A late acknowledgement cannot erase the next draft");
assert.equal(submissions.afterSuccess("first task", "first task"), "");
submissions.finish();
assert.equal(submissions.begin(), true, "A finished or failed submit must permit retry");
submissions.finish();
console.log("Round 57 task submission regressions passed");

const general = new GeneralFormDraft("original");
let confirmations = 0;
assert.equal(general.mayReplace("original", () => { confirmations++; return false; }), true);
assert.equal(confirmations, 0, "Unchanged form does not require a discard prompt");
assert.equal(general.isDirty("draft"), true);
assert.equal(general.mayReplace("draft", () => { confirmations++; return false; }), false);
assert.equal(general.isDirty("draft"), true, "Declining another action retains the pending form");
assert.equal(general.mayReplace("draft", () => { confirmations++; return true; }), true);
assert.equal(general.isDirty("draft"), true, "Confirmation alone cannot acknowledge a failed write");
general.acknowledge("draft");
assert.equal(general.isDirty("draft"), false);
assert.equal(general.isDirty("next edit"), true);
console.log("Round 62 options form draft regressions passed");

const forms = new TaskFormSessions();
const oldForm = forms.get("tasks");
oldForm.draft = "first task";
assert.equal(oldForm.begin(), true);
const rebuiltForm = forms.get("tasks");
assert.equal(rebuiltForm, oldForm, "A rebuilt task renderer shares the submission lease");
assert.equal(rebuiltForm.begin(), false);
rebuiltForm.draft = "new draft";
oldForm.acknowledge("first task");
assert.equal(rebuiltForm.draft, "new draft", "An old acknowledgement cannot erase a newer renderer's input");
forms.prune(new Set());
assert.equal(forms.get("tasks"), oldForm, "A pending task cannot be pruned before acknowledgement");
oldForm.finish();
forms.prune(new Set());
assert.notEqual(forms.get("tasks"), oldForm);
const drafts65 = new WidgetTextDrafts();
drafts65.set("search-a", "typed query");
drafts65.set("search-b", "other query");
assert.equal(drafts65.get("search-a"), "typed query");
drafts65.prune(new Set(["search-a"]));
assert.equal(drafts65.get("search-a"), "typed query");
assert.equal(drafts65.get("search-b"), "");
drafts65.set("search-a", "");
assert.equal(drafts65.get("search-a"), "");
console.log("Round 65 transient widget draft regressions passed");
