import assert from "node:assert/strict";
import { FormPanelCache, parseNumberField } from "../src/lib/form-panel-cache.js";
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
const firstTaskDraft = oldForm.snapshotDraft();
const rebuiltForm = forms.get("tasks");
assert.equal(rebuiltForm, oldForm, "A rebuilt task renderer shares the submission lease");
assert.equal(rebuiltForm.begin(), false);
rebuiltForm.draft = "new draft";
oldForm.acknowledge(firstTaskDraft);
assert.equal(rebuiltForm.draft, "new draft", "An old acknowledgement cannot erase a newer renderer's input");
forms.prune(new Set());
assert.equal(forms.get("tasks"), oldForm, "A pending task cannot be pruned before acknowledgement");
oldForm.finish();
forms.prune(new Set());
assert.equal(forms.get("tasks"), oldForm, "A removed widget cannot silently discard unsubmitted text");
assert.deepEqual(forms.hidden(new Set()).map(([id]) => id), ["tasks"]);
assert.equal(forms.discard("tasks", oldForm, oldForm.snapshotDraft()), true);
forms.prune(new Set());
assert.notEqual(forms.get("tasks"), oldForm);
const drafts65 = new WidgetTextDrafts();
drafts65.set("search-a", "typed query");
drafts65.set("search-b", "other query");
assert.equal(drafts65.get("search-a"), "typed query");
assert.deepEqual(drafts65.hidden(new Set(["search-a"])).map(([id]) => id), ["search-b"]);
assert.equal(drafts65.get("search-a"), "typed query");
assert.equal(drafts65.get("search-b"), "other query");
assert.equal(drafts65.discard("search-b", "stale"), false);
assert.equal(drafts65.discard("search-b", "other query"), true);
assert.equal(drafts65.get("search-b"), "");
drafts65.set("search-a", "");
assert.equal(drafts65.get("search-a"), "");
console.log("Round 65 transient widget draft regressions passed");

assert.equal(parseNumberField("", 42), 42);
assert.equal(parseNumberField("   ", 42), 42);
assert.equal(parseNumberField("0", 42), 0);
assert.equal(parseNumberField("-12.5", 42), -12.5);
assert.equal(parseNumberField("Infinity", 42), 42);
assert.equal(parseNumberField("invalid", 42), 42);
const panelHost69 = {
  childNodes: [] as Array<{ value: string }>,
  replaceChildren(...nodes: Array<{ value: string }>) { this.childNodes = nodes; },
};
const panelCache69 = new FormPanelCache<string, { value: string }>();
let creates69 = 0;
const makePanel69 = (initial: string) => () => {
  creates69++;
  const node = { value: initial };
  panelHost69.childNodes.push(node);
  return () => node.value;
};
const readGradient69 = panelCache69.show("gradient", panelHost69, makePanel69("initial gradient"));
panelHost69.childNodes[0]!.value = "edited gradient";
const readImage69 = panelCache69.show("image", panelHost69, makePanel69("initial image"));
assert.equal(panelHost69.childNodes.length, 1, "Inactive panel fields must be detached");
panelHost69.childNodes[0]!.value = "edited image";
assert.equal(panelCache69.show("gradient", panelHost69, makePanel69("wrong"))(), "edited gradient");
assert.equal(panelCache69.show("image", panelHost69, makePanel69("wrong"))(), "edited image");
assert.equal(readGradient69(), "edited gradient");
assert.equal(readImage69(), "edited image");
assert.equal(creates69, 2, "Each panel is constructed once per dialog");
console.log("Round 69 form panel and numeric input regressions passed");

const { VersionedWidgetValue, WidgetWriteSession } = await import("../src/newtab/versioned-widget-value.js");
const taskState76 = forms.get("versioned-tasks");
const initial76 = [{ id: "a", title: "A", done: false, createdAt: 1, updatedAt: 1 }];
taskState76.committed.observe(initial76, 10);
const draft76 = taskState76.committed.get([]);
draft76[0]!.done = true;
assert.equal(taskState76.committed.get([])[0]?.done, false, "Optimistic edits cannot change the committed list");
assert.equal(taskState76.begin(), true);
assert.equal(forms.get("versioned-tasks").begin(), false, "All task operations share a lease across rebuilds");
taskState76.committed.observe(draft76, 11);
taskState76.committed.observe(initial76, 10);
assert.equal(taskState76.committed.get([])[0]?.done, true, "Old snapshots must not erase acknowledged task changes");
taskState76.committed.observe([], 12);
taskState76.committed.observe(draft76, 11);
assert.deepEqual(taskState76.committed.get([]), [], "A delayed acknowledgement must not restore externally deleted tasks");
taskState76.finish();
assert.equal(taskState76.begin(), true);
taskState76.finish();
const pages76 = new WidgetWriteSession<number>();
pages76.committed.observe(0, 20);
assert.equal(pages76.begin(), true);
assert.equal(pages76.begin(), false);
pages76.committed.observe(1, 21);
pages76.committed.observe(0, 20);
assert.equal(pages76.committed.get(0), 1);
pages76.finish();
assert.equal(pages76.begin(), true);
pages76.finish();
const isolated76 = new VersionedWidgetValue<number>();
assert.equal(isolated76.get(0), 0);
console.log("Round 76 task and link write session regressions passed");

const { localeReloadDecision, hiddenDraftIds } = await import("../src/newtab/protected-page-drafts.js");
assert.equal(localeReloadDecision("en", "ru", false, false), "reload");
assert.equal(localeReloadDecision("en", "ru", true, false), "defer");
assert.equal(localeReloadDecision("en", "ru", false, true), "defer", "A later event must not automatically reload a deferred page");
assert.equal(localeReloadDecision("en", "en", true, true), "none", "Rolled-back preference must dismiss pending reload");
assert.deepEqual(hiddenDraftIds([["visible", { hasUnsaved: true }], ["hidden", { hasUnsaved: true }], ["clean", { hasUnsaved: false }]], new Set(["visible"])), ["hidden"]);
const pending79 = new TaskFormSessions();
assert.equal(pending79.hasPendingDrafts(), false);
const form79 = pending79.get("task");
form79.draft = "typed";
assert.equal(pending79.hasPendingDrafts(), true);
form79.draft = "";
form79.begin();
assert.equal(pending79.hasPendingDrafts(), true);
form79.finish();
assert.equal(pending79.hasPendingDrafts(), false);
const search79 = new WidgetTextDrafts();
search79.set("s", "query");
assert.equal(search79.hasDrafts(), true);
search79.set("s", "");
assert.equal(search79.hasDrafts(), false);
console.log("Round 79 protected page draft regressions passed");

const form82 = new TaskFormSessions().get("task-82");
form82.draft = "repeat";
assert.equal(form82.begin(), true);
const submitted82 = form82.snapshotDraft();
form82.draft = "";
form82.draft = "repeat";
form82.acknowledge(submitted82);
assert.equal(form82.draft, "repeat", "An edit away and back is a new draft, even if its text matches the submitted task");
form82.finish();
assert.equal(form82.begin(), true);
const unchanged82 = form82.snapshotDraft();
form82.draft = "repeat"; // Rendering or submitting the same value is not an edit.
form82.acknowledge(unchanged82);
assert.equal(form82.draft, "", "An untouched successfully submitted draft is cleared");
form82.finish();
form82.draft = "new";
form82.acknowledge(unchanged82);
assert.equal(form82.draft, "new", "A duplicated stale acknowledgement cannot clear a later draft");
console.log("Round 82 task draft generation regressions passed");

const forms85 = new TaskFormSessions();
const hidden85 = forms85.get("removed");
hidden85.draft = "saved for later";
const old85 = hidden85.snapshotDraft();
assert.equal(hidden85.begin(), true);
assert.equal(forms85.discard("removed", hidden85, old85), false, "Pending task drafts must not be discarded");
hidden85.finish();
hidden85.draft = "updated";
assert.equal(forms85.discard("removed", hidden85, old85), false, "A stale recovery row must not discard a newer draft");
forms85.prune(new Set());
assert.equal(forms85.get("removed").draft, "updated");
assert.equal(forms85.hidden(new Set(["removed"])).length, 0, "Restoring the widget returns the original draft to its form");
assert.equal(forms85.discard("removed", hidden85, hidden85.snapshotDraft()), true);
forms85.prune(new Set());
assert.equal(forms85.hasPendingDrafts(), false);
console.log("Round 85 hidden widget text regressions passed");

const { refreshAfterAcknowledgedRuntimeWrite } = await import("../src/newtab/runtime-mutation-recovery.js");
const acknowledged87 = new TaskFormSessions().get("legacy-worker");
acknowledged87.draft = "committed task";
assert.equal(acknowledged87.begin(), true);
const submitted87 = acknowledged87.snapshotDraft();
const refreshError87 = new Error("storage read failed");
const warnings87: unknown[] = [];
await refreshAfterAcknowledgedRuntimeWrite(async () => { throw refreshError87; }, (error) => warnings87.push(error));
acknowledged87.acknowledge(submitted87);
acknowledged87.finish();
assert.equal(acknowledged87.draft, "", "A failed post-commit read must not keep a successfully submitted task ready to submit again");
assert.deepEqual(warnings87, [refreshError87], "The independent refresh failure remains observable");
let refreshed87 = false;
await refreshAfterAcknowledgedRuntimeWrite(async () => { refreshed87 = true; }, (error) => warnings87.push(error));
assert.equal(refreshed87, true);
assert.equal(warnings87.length, 1);
console.log("Round 87 acknowledged runtime refresh regressions passed");
