import assert from "node:assert/strict";

import { exportBackup, importBackup, migrateBackup, PRE_IMPORT_BACKUP_KEY } from "../src/lib/backup.js";
import { normalizeLastBlockedUrls } from "../src/lib/blocklist.js";
import { FOCUS_STATS_KEY, normalizeFocusStats, recordBlockedNavigation } from "../src/lib/focus-stats.js";
import { MAX_BLOCKED_SITES, MAX_LOCAL_TASKS_PER_INSTANCE, MAX_START_PAGE_BLOCKS } from "../src/lib/platform-limits.js";
import { mutateStartPageRuntimeState, normalizeRuntimeState } from "../src/lib/start-page-runtime.js";
import { cloneSettings, DEFAULT_SETTINGS, normalizeStartPageSettings } from "../src/lib/start-page-settings.js";
import type { BlockInstance, LocalTask, StartPageSettings } from "../src/lib/start-page-types.js";
import { normalizeDomainMinutes } from "../src/lib/start-page-validation-primitives.js";

function nullDictionary<T>(entries: readonly (readonly [string, T])[]): Record<string, T> {
  const dictionary = Object.create(null) as Record<string, T>;
  for (const [key, value] of entries) dictionary[key] = value;
  return dictionary;
}

function own(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

const specialSettings = cloneSettings(DEFAULT_SETTINGS);
const note = specialSettings.layout.blocks.find((block) => block.type === "note");
const localTasks = specialSettings.layout.blocks.find((block) => block.type === "localTasks");
const timer = specialSettings.layout.blocks.find((block) => block.type === "timer");
const links = specialSettings.layout.blocks.find((block) => block.type === "links");
assert.ok(note && localTasks && timer && links, "Default settings must expose all special-key fixture block types");
note.id = "__proto__";
localTasks.id = "constructor";
timer.id = "toString";
links.id = "hasOwnProperty";
specialSettings.focusStats.domainMinutes = nullDictionary([
  ["__proto__", 17],
  ["constructor", 19],
  ["toString", 23],
]);
const normalizedSpecialSettings = normalizeStartPageSettings(specialSettings);
const normalizedSpecialIds = new Set(normalizedSpecialSettings.layout.blocks.map((block) => block.id));
for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
  assert.equal(normalizedSpecialIds.has(id), true, `Block ID ${id} must remain user data`);
}

const runtimeSource = {
  version: 2,
  updatedAt: 123,
  notes: nullDictionary([["__proto__", "prototype-safe note"]]),
  tasks: nullDictionary([[
    "constructor", [{ id: "task-special", title: "Keep constructor task", done: false, createdAt: 1, updatedAt: 1 }],
  ]]),
  clocks: nullDictionary([[
    "toString", { type: "timer", running: false, startedAt: null, accumulatedMs: 1_000, durationMs: 60_000, targetAt: null },
  ]]),
  linkPages: nullDictionary([["hasOwnProperty", 4]]),
};
const normalizedRuntime = normalizeRuntimeState(runtimeSource, normalizedSpecialSettings);
for (const dictionary of [normalizedRuntime.notes, normalizedRuntime.tasks, normalizedRuntime.clocks, normalizedRuntime.linkPages]) {
  assert.equal(Object.getPrototypeOf(dictionary), null, "Runtime user-keyed dictionaries must not inherit Object.prototype");
}
assert.equal(normalizedRuntime.notes.__proto__, "prototype-safe note");
assert.equal(normalizedRuntime.tasks.constructor?.[0]?.title, "Keep constructor task");
assert.equal(normalizedRuntime.clocks.toString?.accumulatedMs, 1_000);
assert.equal(normalizedRuntime.linkPages.hasOwnProperty, 4);

const normalizedMinutes = normalizeDomainMinutes(JSON.parse('{"__proto__":17,"constructor":19,"toString":23}'));
assert.equal(Object.getPrototypeOf(normalizedMinutes), null);
assert.equal(normalizedMinutes.__proto__, 17);
assert.equal(normalizedMinutes.constructor, 19);
assert.equal(normalizedMinutes.tostring, 23);

const normalizedUrls = normalizeLastBlockedUrls(JSON.parse(
  '{"__proto__":"https://__proto__/path","constructor":"https://constructor/path","toString":"https://toString/path"}',
));
assert.equal(Object.getPrototypeOf(normalizedUrls), null);
assert.equal(normalizedUrls.__proto__, "https://__proto__/path");
assert.equal(normalizedUrls.constructor, "https://constructor/path");
assert.equal(normalizedUrls.tostring, "https://toString/path");

const normalizedStats = normalizeFocusStats(JSON.parse(`{
  "version":1,
  "totals":{},
  "byDay":{},
  "byDomain":{
    "__proto__":{"blockHits":1,"avoidedVisits":1,"estimatedMinutesSaved":17,"unblocksAfterCountdown":0,"lastAvoidedAt":1},
    "constructor":{"blockHits":2,"avoidedVisits":0,"estimatedMinutesSaved":0,"unblocksAfterCountdown":0,"lastAvoidedAt":0}
  },
  "processedClockCompletions":{"toString":42}
}`));
assert.equal(Object.getPrototypeOf(normalizedStats.byDomain), null);
assert.equal(Object.getPrototypeOf(normalizedStats.processedClockCompletions), null);
assert.equal(normalizedStats.byDomain.__proto__?.estimatedMinutesSaved, 17);
assert.equal(normalizedStats.byDomain.constructor?.blockHits, 2);
assert.equal(normalizedStats.processedClockCompletions.toString, 42);

function clone<T>(value: T): T {
  return structuredClone(value);
}

let storageState: Record<string, unknown> = {};
let storageApiCalls = 0;
let dnrApiCalls = 0;
let alarmApiCalls = 0;
let alarms: Array<{ name: string; scheduledTime: number; periodInMinutes?: number }> = [];

function storageGet(keys?: string | string[] | Record<string, unknown> | null): Record<string, unknown> {
  if (keys == null) return clone(storageState);
  const selected: Record<string, unknown> = {};
  if (typeof keys === "string") {
    if (own(storageState, keys)) selected[keys] = clone(storageState[keys]);
    return selected;
  }
  if (Array.isArray(keys)) {
    for (const key of keys) if (own(storageState, key)) selected[key] = clone(storageState[key]);
    return selected;
  }
  for (const [key, fallback] of Object.entries(keys)) {
    selected[key] = own(storageState, key) ? clone(storageState[key]) : clone(fallback);
  }
  return selected;
}

Object.defineProperty(globalThis, "chrome", {
  configurable: true,
  value: {
    storage: {
      local: {
        async get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
          storageApiCalls += 1;
          return storageGet(keys);
        },
        async set(items: Record<string, unknown>): Promise<void> {
          storageApiCalls += 1;
          for (const [key, value] of Object.entries(items)) storageState[key] = clone(value);
        },
        async remove(keys: string | string[]): Promise<void> {
          storageApiCalls += 1;
          for (const key of typeof keys === "string" ? [keys] : keys) delete storageState[key];
        },
      },
    },
    alarms: {
      async getAll(): Promise<typeof alarms> { alarmApiCalls += 1; return clone(alarms); },
      async create(name: string, info: { when: number; periodInMinutes?: number }): Promise<void> {
        alarmApiCalls += 1;
        alarms = alarms.filter((alarm) => alarm.name !== name);
        alarms.push({ name, scheduledTime: info.when, ...(info.periodInMinutes ? { periodInMinutes: info.periodInMinutes } : {}) });
      },
      async clear(name: string): Promise<boolean> {
        alarmApiCalls += 1;
        const before = alarms.length;
        alarms = alarms.filter((alarm) => alarm.name !== name);
        return alarms.length !== before;
      },
    },
    declarativeNetRequest: {
      RuleActionType: { REDIRECT: "redirect" },
      ResourceType: { MAIN_FRAME: "main_frame" },
      async getDynamicRules(): Promise<never[]> { dnrApiCalls += 1; return []; },
      async updateDynamicRules(): Promise<void> { dnrApiCalls += 1; },
    },
    runtime: { getURL(path: string): string { return `chrome-extension://round19/${path}`; } },
  },
});

storageState = {
  startPageSettings: normalizedSpecialSettings,
  startPageRuntimeState: { version: 2, updatedAt: 1, clocks: {}, notes: {}, tasks: {}, linkPages: {} },
  [FOCUS_STATS_KEY]: { version: 1, totals: {}, byDay: {}, byDomain: {}, processedClockCompletions: {} },
};
await mutateStartPageRuntimeState((runtime) => {
  runtime.notes["__proto__"] = "written through runtime mutation";
  return { state: runtime, result: undefined };
});
const storedSpecialRuntime = storageState.startPageRuntimeState as { notes: Record<string, string> };
assert.equal(own(storedSpecialRuntime.notes, "__proto__"), true,
  "Mutation clones must preserve prototype-free dictionaries before writing a special instance ID");
assert.equal(storedSpecialRuntime.notes.__proto__, "written through runtime mutation");
delete (Object.prototype as Record<string, unknown>).blockHits;
await recordBlockedNavigation("__proto__");
assert.equal(own(Object.prototype, "blockHits"), false, "Special domains must never mutate Object.prototype");
const storedFocusStats = storageState[FOCUS_STATS_KEY] as { byDomain: Record<string, { blockHits: number; estimatedMinutesSaved: number }> };
assert.equal(own(storedFocusStats.byDomain, "__proto__"), true);
assert.equal(storedFocusStats.byDomain.__proto__.blockHits, 1);
assert.equal(storedFocusStats.byDomain.__proto__.estimatedMinutesSaved, 17);

function repeatedBlocks(count: number): BlockInstance[] {
  const source = DEFAULT_SETTINGS.layout.blocks.find((block) => block.type === "dateTime");
  assert.ok(source);
  return Array.from({ length: count }, (_, index) => ({
    ...structuredClone(source),
    id: `round19-block-${index}`,
    order: index,
    row: Math.min(500, index + 1),
  }));
}

function tasks(count: number): LocalTask[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `round19-task-${index}`,
    title: `Task ${index}`,
    done: false,
    createdAt: index + 1,
    updatedAt: index + 1,
  }));
}

function backup(storage: Record<string, unknown>): Record<string, unknown> {
  return {
    app: "Start Tab",
    version: 4,
    exportedAt: new Date().toISOString(),
    snapshotId: "round19-backup",
    storage,
  };
}

const taskBlock = DEFAULT_SETTINGS.layout.blocks.find((block) => block.type === "localTasks");
assert.ok(taskBlock);
const corruptedSettings = cloneSettings(DEFAULT_SETTINGS);
corruptedSettings.layout.mode = "free";
corruptedSettings.layout.blocks = repeatedBlocks(MAX_START_PAGE_BLOCKS + 1);
const corruptedRuntime = {
  version: 2,
  updatedAt: 5,
  tasks: { [taskBlock.id]: tasks(MAX_LOCAL_TASKS_PER_INSTANCE + 1) },
};
const corruptedBlockedSites = Array.from({ length: MAX_BLOCKED_SITES + 1 }, (_, index) => `round19-${index}.example`);
storageState = {
  blockedSites: corruptedBlockedSites,
  startPageSettings: corruptedSettings,
  startPageRuntimeState: corruptedRuntime,
  startTabDataRevision: { version: 1, updatedAt: 9 },
};
storageApiCalls = dnrApiCalls = alarmApiCalls = 0;

const recoveredExport = await exportBackup();
const exportedSettings = recoveredExport.storage.startPageSettings as StartPageSettings;
const exportedRuntime = recoveredExport.storage.startPageRuntimeState as { tasks: Record<string, LocalTask[]> };
assert.equal((recoveredExport.storage.blockedSites as string[]).length, MAX_BLOCKED_SITES,
  "Export must bound corrupted local blocked sites so a recoverable backup can still be created");
assert.equal(exportedSettings.layout.blocks.length, MAX_START_PAGE_BLOCKS,
  "Export must normalize corrupted local settings to the editable supported boundary");
assert.equal(exportedRuntime.tasks[taskBlock.id]?.length ?? 0, 0,
  "Runtime data for blocks absent from bounded normalized settings must not survive as an orphan");

const validImport = backup({
  blockedSites: [],
  startPageSettings: DEFAULT_SETTINGS,
  startPageRuntimeState: { version: 2, updatedAt: 1, clocks: {}, notes: {}, tasks: {}, linkPages: {} },
});
const importReport = await importBackup(validImport);
assert.equal(importReport.targetVersion, 4);
const recovery = storageState[PRE_IMPORT_BACKUP_KEY] as { storage: Record<string, unknown> };
assert.ok(recovery, "A pre-import recovery backup must be persisted even when previous local state was oversized");
assert.equal((recovery.storage.blockedSites as string[]).length, MAX_BLOCKED_SITES);
assert.equal((recovery.storage.startPageSettings as StartPageSettings).layout.blocks.length, MAX_START_PAGE_BLOCKS);
assert.deepEqual(storageState.blockedSites, [], "The valid incoming backup must replace corrupted local state");
assert.ok(storageApiCalls > 0 && dnrApiCalls > 0 && alarmApiCalls > 0,
  "Successful recovery import must execute storage, DNR, and alarm reconciliation");

storageApiCalls = dnrApiCalls = alarmApiCalls = 0;
const oversizedIncoming = backup({
  blockedSites: Array.from({ length: MAX_BLOCKED_SITES + 1 }, (_, index) => `incoming-${index}.example`),
  startPageSettings: DEFAULT_SETTINGS,
});
assert.throws(
  () => migrateBackup(oversizedIncoming),
  /supports at most 5000 blocked sites/,
  "Externally supplied oversized backups must remain strictly rejected",
);
await assert.rejects(
  () => importBackup(oversizedIncoming),
  /supports at most 5000 blocked sites/,
);
assert.equal(storageApiCalls + dnrApiCalls + alarmApiCalls, 0,
  "Strict external backup rejection must happen before any Chrome API mutation or read");

console.log("Round 19 fixtures passed");
