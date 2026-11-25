import assert from "node:assert/strict";
import { WidgetRequestCache } from "../src/newtab/widget-request-cache.js";
import { parseIpPayload, parseWeatherPayload, validDateOnly } from "../src/newtab/provider-payloads.js";
import { fetchWidgetJson } from "../src/newtab/widget-network.js";
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

assert.deepEqual(parseIpPayload({ ip: " 203.0.113.10 ", country: " NL " }), { ip: "203.0.113.10", country: "NL" });
assert.deepEqual(parseIpPayload({ query: "2001:db8::1" }), { ip: "2001:db8::1", country: "" });
for (const ip of ["", "999.0.0.1", "example.com", "127.1", "abc:def", "2001:db8:::1", "1.2.3.4/path"]) {
  assert.equal(parseIpPayload({ ip }), null, "Malformed provider IP must not suppress the fallback: " + ip);
}
assert.equal(parseIpPayload({ success: false, ip: "203.0.113.1" }), null);
assert.equal(validDateOnly("2024-02-29"), true);
assert.equal(validDateOnly("2025-02-29"), false);
assert.equal(validDateOnly("2026-02-31"), false);
assert.equal(validDateOnly("2026-11-25"), true);
assert.equal(validDateOnly("not a date"), false);
assert.throws(() => parseWeatherPayload({ current: { temperature_2m: Infinity } }), /no usable data/);
assert.throws(() => parseWeatherPayload({ error: true }), /Invalid weather/);
assert.deepEqual(parseWeatherPayload({
  current: { temperature_2m: 7, weather_code: NaN },
  current_units: { temperature_2m: 123 },
  daily: { time: ["2026-11-25", "2026-02-31", "2026-11-26", "2026-11-27", "2026-11-25"],
    temperature_2m_min: [1, 0, 10, 1, 0], temperature_2m_max: [8, 9, 5, 3, 5], weather_code: [3, 0, 0, 999, 1] },
}), { currentTemperature: 7, currentCode: null, unit: "°C", days: [{ date: "2026-11-25", min: 1, max: 8, code: 3 }] });
let clock = 0;
const cache = new WidgetRequestCache(2, () => clock);
let finish!: (value: number) => void;
let loads = 0;
const firstRequest = cache.get("first", 10, () => { loads++; return new Promise<number>((resolve) => { finish = resolve; }); });
await Promise.resolve();
clock = 100;
assert.equal(cache.get("first", 10, async () => 99), firstRequest, "Pending loads must be shared even after the ordinary TTL");
finish(1);
assert.equal(await firstRequest, 1);
clock = 109;
assert.equal(await cache.get("first", 10, async () => 99), 1, "TTL begins when the response succeeds");
clock = 110;
assert.equal(await cache.get("first", 10, async () => 2), 2);
assert.equal(loads, 1);
await cache.get("second", 100, async () => 3);
await cache.get("third", 100, async () => 4);
assert.equal(await cache.get("first", 100, async () => 5), 5, "Old cache keys must be evicted at capacity");
await assert.rejects(() => cache.get("bad", 100, async () => { throw new Error("offline"); }), /offline/);
assert.equal(await cache.get("bad", 100, async () => 6), 6, "Rejected requests must be retryable");
const realFetch = globalThis.fetch;
try {
  globalThis.fetch = async (_url, init) => {
    assert.ok(init?.signal);
    return Response.json({ ok: true });
  };
  assert.deepEqual(await fetchWidgetJson("https://example.com"), { ok: true });
  globalThis.fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    assert.ok(signal);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  // AbortSignal.timeout uses an unref'ed timer in Node; keep the fixture alive.
  const keepAlive = setTimeout(() => undefined, 100);
  try { await assert.rejects(() => fetchWidgetJson("https://example.com", 5), /timeout/i); }
  finally { clearTimeout(keepAlive); }
} finally { globalThis.fetch = realFetch; }
console.log("Round 60 provider payload, deadline and cache regressions passed");

const versioned = new NoteDraft("old", 10);
versioned.edit("mine");
const saving73 = versioned.beginSave()!;
versioned.observeCanonical("external", 12);
versioned.succeed(saving73, 11);
assert.equal(versioned.value, "external", "A newer canonical edit arriving before acknowledgement wins over clean acknowledged text");
versioned.observeCanonical("mine", 11);
assert.equal(versioned.value, "external", "A stale renderer snapshot cannot revert a newer canonical revision");
const concurrent73 = new NoteDraft("old", 10);
concurrent73.edit("first");
const pending73 = concurrent73.beginSave()!;
concurrent73.edit("second");
concurrent73.observeCanonical("external", 12);
concurrent73.succeed(pending73, 11);
assert.equal(concurrent73.value, "second");
assert.equal(concurrent73.failed, true, "A later local draft must not silently rebase over a newer canonical edit");
assert.equal(concurrent73.beginSave(), null);
assert.throws(() => concurrent73.discard("first", 11), /changed during conflict resolution/);
concurrent73.discard("external", 12);
assert.equal(concurrent73.hasUnsaved, false);
const ack73 = new NoteDraft("old", 10);
ack73.edit("new");
const ackAttempt73 = ack73.beginSave()!;
ack73.succeed(ackAttempt73, 11);
ack73.observeCanonical("old", 10);
assert.equal(ack73.value, "new", "A successful save must survive an old render before storage refresh");
ack73.observeCanonical("fresh", 12);
assert.equal(ack73.value, "fresh");
console.log("Round 73 note revision regressions passed");

const { createDatePartsFormatter, formatDateParts } = await import("../src/newtab/date-pattern.js");
const { buildSearchUrl } = await import("../src/lib/start-page-validation-primitives.js");
const date77 = new Date("2026-01-01T00:05:06Z");
const parts77 = createDatePartsFormatter("fi-FI", "UTC")(date77);
assert.equal(parts77.hour, "00");
assert.equal(formatDateParts("MMMM HH:mm:ss", parts77), `${parts77.month} 00:05:06`, "Localized month names must not be interpreted as format tokens");
assert.equal(formatDateParts("MMMM mm dddd ss", { month: "tammikuu", minute: "05", weekday: "ss:mm", second: "06" }), "tammikuu 05 ss:mm 06");
const midnight77 = createDatePartsFormatter("en-US", "UTC")(date77);
assert.equal(formatDateParts("HH:mm", midnight77), "00:05");
assert.equal(buildSearchUrl("https://example.com/?q={query}&again={query}", "a&b #?"), "https://example.com/?q=a%26b%20%23%3F&again=a%26b%20%23%3F");
assert.equal(buildSearchUrl("https://example.com/?q={query}", "\uD800"), "https://example.com/?q=%EF%BF%BD");
assert.equal(buildSearchUrl("https://{query}.example.com/", "invalid hostname"), null);
assert.equal(buildSearchUrl("javascript:{query}", "alert(1)"), null);
assert.equal(buildSearchUrl("https://example.com/", "ignored"), null);
console.log("Round 77 localized date formatting and search URL regressions passed");
