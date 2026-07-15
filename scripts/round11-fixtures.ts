import assert from "node:assert/strict";
import { migrateBackup } from "../src/lib/backup.js";
import type { I18n } from "../src/lib/i18n.js";
import { calendarEventLabel } from "../src/newtab/block-renderers-integrations.js";

const legacyBlocklistBackup = {
  app: "Start Tab" as const,
  version: 3,
  exportedAt: "2026-07-15T00:00:00.000Z",
  storage: {
    blockedSites: ["example.com", "www.example.com"],
    blocked: ["legacy.example", "https://www.example.com/path"],
  },
};

const migrated = migrateBackup(legacyBlocklistBackup);
assert.deepEqual(
  migrated.storage.blockedSites,
  ["example.com", "legacy.example"],
  "Backup migration must merge, normalize, and deduplicate current and legacy blocklist keys",
);
assert.equal(
  Object.prototype.hasOwnProperty.call(migrated.storage, "blocked"),
  false,
  "Migrated backups must not preserve the obsolete blocklist key",
);

const i18n: I18n = {
  locale: "en",
  t: (key) => key === "calendarAllDay" ? "All day" : key,
  list: () => [],
};

const allDayLabel = calendarEventLabel({
  id: "all-day-event",
  title: "Holiday",
  start: "2026-07-15",
  end: "2026-07-16",
  allDay: true,
}, i18n);
assert.match(allDayLabel, /^Holiday · /);
assert.match(allDayLabel, /All day$/);
assert.doesNotMatch(allDayLabel, /\d{1,2}:\d{2}/, "All-day events must not render a clock time");

const timedLabel = calendarEventLabel({
  id: "timed-event",
  title: "Meeting",
  start: "2026-07-15T10:30:00Z",
  end: "2026-07-15T11:00:00Z",
  allDay: false,
}, i18n);
assert.match(timedLabel, /^Meeting · /);
assert.match(timedLabel, /\d{1,2}:\d{2}/, "Timed events must keep their clock time");

console.log("Round 11 fixtures passed");
