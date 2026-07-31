import assert from "node:assert/strict";
import { normalizeRuntimeState } from "../src/lib/start-page-runtime.js";
import {
  blockDeletionRequiresDataConfirmation,
  createBlockInstance,
  createDefaultStartPageSettings,
} from "../src/lib/start-page-settings.js";
import { containsSplitViewMarker } from "../src/lib/split-view-markers.js";
import { calendarEventLabel, weatherDaysForDisplay } from "../src/newtab/block-renderers-integrations.js";
import type { I18n } from "../src/lib/i18n.js";

const translations: Record<string, string> = {
  calendarAllDay: "All day",
  calendarUntitledEvent: "Untitled event",
};
const i18n: I18n = {
  locale: "en",
  t: (key) => translations[key] ?? key,
  list: () => [],
};

for (const marker of [
  "split-view",
  "split_view",
  "splitview",
  "side-by-side",
  "sidebyside",
  "side_panel",
  "side-panel",
  "tab-picker",
  "tab_picker",
  "tabpicker",
  "select-tab",
  "select_tab",
  "selecttab",
]) {
  assert.equal(containsSplitViewMarker(`chrome://newtab/${marker}`), true, `Missing explicit Split View marker: ${marker}`);
}
for (const falsePositive of ["chrome://newtab/split", "chrome://newtab/picker", "chrome://newtab/pane"]) {
  assert.equal(containsSplitViewMarker(falsePositive), false, `Generic token must not bypass Start Tab: ${falsePositive}`);
}

assert.equal(
  calendarEventLabel({ id: "invalid-time", title: "Meeting", start: "not-a-date", end: "", allDay: false }, i18n),
  "Meeting",
  "An invalid timed event must not be mislabeled as all-day",
);
assert.equal(
  calendarEventLabel({ id: "untitled", title: "   ", start: "", end: "", allDay: false }, i18n),
  "Untitled event",
  "Calendar events without a title must use a localized fallback",
);
assert.equal(
  calendarEventLabel({ id: "all-day", title: "Holiday", start: "invalid", end: "", allDay: true }, i18n),
  "Holiday · All day",
  "Only events explicitly declared all-day may use the all-day label",
);

assert.deepEqual(weatherDaysForDisplay({ days: [] }, "day"), [], "Missing daily weather must remain an explicit empty result");
const days = Array.from({ length: 9 }, (_, index) => ({ date: `2026-08-${String(index + 1).padStart(2, "0")}`, min: index, max: index + 10, code: 0 }));
assert.equal(weatherDaysForDisplay({ days }, "day").length, 1, "Day mode must render one complete forecast day");
assert.equal(weatherDaysForDisplay({ days }, "week").length, 7, "Week mode must cap output at seven complete forecast days");

const settings = createDefaultStartPageSettings(1);
const note = createBlockInstance("note", { id: "note-a", config: { type: "note", placeholder: "", confirmDeleteWithContent: true } });
const tasks = createBlockInstance("localTasks", { id: "tasks-a", config: { type: "localTasks", placeholder: "", showCompleted: true, confirmDeleteWithContent: true } });
const timer = createBlockInstance("timer", { id: "timer-a" });
settings.layout.blocks = [note, tasks, timer];
const runtime = normalizeRuntimeState(undefined, settings);
runtime.notes[note.id] = "Important";
runtime.tasks[tasks.id] = [{ id: "task-1", title: "Keep", completed: false, createdAt: 1, updatedAt: 1 }];
runtime.clocks[timer.id] = { ...runtime.clocks[timer.id]!, accumulatedMs: 1000 };

assert.equal(blockDeletionRequiresDataConfirmation(note, runtime), true, "Non-empty notes must honor the enabled content warning");
assert.equal(blockDeletionRequiresDataConfirmation({ ...note, config: { ...note.config, confirmDeleteWithContent: false } }, runtime), false,
  "Disabling the note content warning must fall back to the generic block confirmation");
assert.equal(blockDeletionRequiresDataConfirmation(tasks, runtime), true, "Non-empty local tasks must honor the enabled content warning");
assert.equal(blockDeletionRequiresDataConfirmation({ ...tasks, config: { ...tasks.config, confirmDeleteWithContent: false } }, runtime), false,
  "Disabling the task content warning must fall back to the generic block confirmation");
assert.equal(blockDeletionRequiresDataConfirmation(timer, runtime), true, "A progressed clock must receive the saved-data deletion warning");
runtime.clocks[timer.id] = { ...runtime.clocks[timer.id]!, accumulatedMs: 0, running: false };
assert.equal(blockDeletionRequiresDataConfirmation(timer, runtime), false, "A pristine clock needs only the generic block confirmation");

console.log("Round 37 fixtures passed");
