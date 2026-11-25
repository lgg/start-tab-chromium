import assert from "node:assert/strict";
import { NoteDraft } from "../src/newtab/note-draft.js";
import { providerSelectionIndexAfterEdit } from "../src/lib/block-settings-editor.js";
import type { StartPageRuntimeState } from "../src/lib/start-page-runtime.js";
import {
  recentHistorySearchLimit,
  validatedWeatherCoordinates,
  visibleWebUrlItems,
} from "../src/newtab/block-renderers-integrations.js";
import { sameRuntimeContent } from "../src/newtab/storage-change-plan.js";

const runtime = (updatedAt: number, note: string): StartPageRuntimeState => ({
  version: 2,
  updatedAt,
  clocks: {},
  notes: { note: note },
  tasks: {},
  linkPages: {},
});

assert.equal(
  sameRuntimeContent(runtime(1, "draft"), runtime(2, "draft")),
  true,
  "A self-echoed runtime write must refresh the revision without forcing a DOM rebuild",
);
assert.equal(
  sameRuntimeContent(runtime(2, "draft"), runtime(3, "external")),
  false,
  "A real external runtime change must still refresh and render",
);
const reorderedLeft = runtime(1, "draft");
reorderedLeft.notes.second = "two";
const reorderedRight = runtime(2, "draft");
reorderedRight.notes = { second: "two", note: "draft" };
assert.equal(
  sameRuntimeContent(reorderedLeft, reorderedRight),
  true,
  "Dictionary insertion order alone must not trigger a full Start Tab rebuild",
);

const history = visibleWebUrlItems([
  { title: "Settings", url: "chrome://settings" },
  { title: "Extension", url: "chrome-extension://example/page.html" },
  { title: "  First page  ", url: "https://example.com/first" },
  { title: "   ", url: "https://example.com/second" },
  { title: "Third page", url: "https://example.com/third" },
], 2);
assert.deepEqual(history, [
  { title: "First page", url: "https://example.com/first" },
  { title: "https://example.com/second", url: "https://example.com/second" },
], "Unsafe leading history entries must not consume the visible result limit");
assert.deepEqual(visibleWebUrlItems([{ title: "Page", url: "https://example.com" }], 0), []);
assert.deepEqual(visibleWebUrlItems([{ title: "Page", url: "https://example.com" }], Number.NaN), []);
assert.equal(recentHistorySearchLimit(0), 0);
assert.equal(recentHistorySearchLimit(Number.NaN), 0);
assert.equal(recentHistorySearchLimit(1), 100);
assert.equal(recentHistorySearchLimit(50), 500);
assert.equal(recentHistorySearchLimit(5000), 500);

assert.deepEqual(validatedWeatherCoordinates(52.3676, 4.9041), { latitude: 52.3676, longitude: 4.9041 });
for (const [latitude, longitude] of [
  [91, 0],
  [-91, 0],
  [0, 181],
  [0, -181],
  [Number.NaN, 0],
  [0, Number.POSITIVE_INFINITY],
  ["52.3", 4.9],
]) {
  assert.equal(
    validatedWeatherCoordinates(latitude, longitude),
    null,
    `Invalid geocoding coordinates must be rejected: ${String(latitude)}, ${String(longitude)}`,
  );
}

const providers = [
  { id: "alpha", title: "Alpha", urlTemplate: "https://a.example/?q={query}" },
  { id: "renamed", title: "Beta", urlTemplate: "https://b.example/?q={query}" },
  { id: "gamma", title: "Gamma", urlTemplate: "https://c.example/?q={query}" },
];
assert.equal(
  providerSelectionIndexAfterEdit("beta", 1, providers),
  1,
  "Renaming the selected provider must keep the same provider row selected",
);
assert.equal(
  providerSelectionIndexAfterEdit("gamma", 2, providers.slice(1)),
  1,
  "Removing a row before the selected provider must preserve the selected provider by ID",
);
assert.equal(
  providerSelectionIndexAfterEdit("beta", 1, providers.slice(0, 2)),
  1,
  "Removing the selected provider must fall back to the adjacent row rather than the first row",
);
assert.equal(providerSelectionIndexAfterEdit("missing", 4, providers), 2);
assert.equal(providerSelectionIndexAfterEdit("missing", 0, []), -1);

console.log("Round 34 fixtures passed");

const draft = new NoteDraft("saved");
assert.equal(draft.hasUnsaved, false);
draft.edit("first draft");
const firstNote = draft.beginSave();
assert.ok(firstNote);
assert.deepEqual(firstNote, { expectedValue: "saved", value: "first draft" });
draft.edit("newer draft");
draft.observeCanonical("first draft"); // storage event or new renderer
assert.equal(draft.value, "newer draft", "A rebuilt note widget must preserve unsaved typing");
assert.equal(draft.beginSave(), null, "A newer edit waits for the in-flight save");
draft.succeed(firstNote);
assert.equal(draft.expectedValue, "first draft");
assert.equal(draft.value, "newer draft");
const secondNote = draft.beginSave();
assert.ok(secondNote);
assert.deepEqual(secondNote, { expectedValue: "first draft", value: "newer draft" });
draft.fail(secondNote);
assert.equal(draft.failed, true);
assert.equal(draft.hasUnsaved, true);
draft.observeCanonical("external note");
assert.equal(draft.value, "newer draft", "A conflict must retain the unsaved text instead of replacing it");
assert.equal(draft.expectedValue, "first draft", "External data must never silently rebase a conflicted draft");
assert.equal(draft.beginSave(), null, "Conflicted notes must not retry without explicit resolution");
draft.rebaseForRetry("external note");
const retryNote = draft.beginSave();
assert.ok(retryNote);
assert.deepEqual(retryNote, { expectedValue: "external note", value: "newer draft" });
draft.succeed(firstNote); // stale callback
assert.equal(draft.saving, true);
draft.succeed(retryNote);
assert.equal(draft.hasUnsaved, false);
draft.observeCanonical("new external note");
assert.equal(draft.value, "new external note", "A clean note follows canonical external edits");
draft.edit("discard me");
const failedNote = draft.beginSave();
assert.ok(failedNote);
draft.fail(failedNote);
draft.discard("latest saved");
assert.equal(draft.value, "latest saved");
assert.equal(draft.hasUnsaved, false);
const reverting = new NoteDraft("original");
reverting.edit("intermediate");
const intermediate = reverting.beginSave();
assert.ok(intermediate);
reverting.edit("original");
assert.equal(reverting.hasUnsaved, true, "Reverting while a save is pending still requires a compensating save");
reverting.succeed(intermediate);
assert.deepEqual(reverting.beginSave(), { expectedValue: "intermediate", value: "original" });
console.log("Round 58 page-lifetime note draft regressions passed");
