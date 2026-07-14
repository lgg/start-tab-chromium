import assert from "node:assert/strict";
import { FOCUS_STATS_KEY, normalizeFocusStats } from "../src/lib/focus-stats.js";
import { migrateBackup } from "../src/lib/backup.js";
import { isMessage } from "../src/lib/messages.js";
import {
  BUILT_IN_THEMES,
  DEFAULT_SETTINGS,
  cloneSettings,
  cloneTheme,
  createBlockInstance,
  createThemeId,
} from "../src/lib/start-page-defaults.js";
import {
  START_PAGE_RUNTIME_KEY,
  defaultClockForBlock,
  elapsedClockMs,
  getStartPageRuntimeState,
  isFutureRuntimeSchema,
  normalizeRuntimeState,
  setStartPageRuntimeState,
  pauseClockState,
  remainingClockMs,
  startClockState,
} from "../src/lib/start-page-runtime.js";
import {
  START_PAGE_SCHEMA_VERSION,
  canAddBlock,
  cloneBlock,
  getStartPageSettings,
  isFutureStartPageSchema,
  normalizeStartPageSettings,
  normalizeTheme,
  setStartPageSettings,
  type BlockInstance,
  type StartPageSettings,
} from "../src/lib/start-page-settings.js";

function findBlock<T extends BlockInstance["type"]>(
  settings: StartPageSettings,
  type: T,
): Extract<BlockInstance, { type: T }> {
  const block = settings.layout.blocks.find(
    (candidate): candidate is Extract<BlockInstance, { type: T }> => candidate.type === type,
  );
  assert.ok(block, `Expected a ${type} block`);
  return block;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

const clean = normalizeStartPageSettings(undefined);
assert.equal(clean.schemaVersion, START_PAGE_SCHEMA_VERSION);
assert.ok(clean.layout.blocks.length > 0);
assert.ok(unique(clean.layout.blocks.map((block) => block.id)), "Clean-install block IDs must be unique");
for (const singleton of ["commands", "recent", "browserPinned", "stats"] as const) {
  assert.ok(clean.layout.blocks.filter((block) => block.type === singleton).length <= 1);
}

const timerA = createBlockInstance("timer");
const timerB = createBlockInstance("timer");
assert.notEqual(timerA.id, timerB.id, "Repeated blocks must receive stable unique IDs");
timerA.config.durationSeconds = 77;
assert.notEqual(timerA.config.durationSeconds, timerB.config.durationSeconds, "Mutable configs must not be shared");
const timerClone = cloneBlock(timerA);
timerClone.config.durationSeconds = 88;
assert.equal(timerA.config.durationSeconds, 77, "Cloning must deep-copy mutable config");

const singletonSettings = cloneSettings(DEFAULT_SETTINGS);
const stats = findBlock(singletonSettings, "stats");
singletonSettings.layout.blocks.push({ ...cloneBlock(stats), id: "duplicate-stats", order: 999 });
const normalizedSingletons = normalizeStartPageSettings(singletonSettings);
assert.equal(normalizedSingletons.layout.blocks.filter((block) => block.type === "stats").length, 1);
assert.equal(canAddBlock(normalizedSingletons, "stats"), false);
assert.equal(canAddBlock(normalizedSingletons, "timer"), true);

const deletedSingleton = cloneSettings(DEFAULT_SETTINGS);
deletedSingleton.layout.blocks = deletedSingleton.layout.blocks.filter((block) => block.type !== "stats");
const normalizedDeletedSingleton = normalizeStartPageSettings(deletedSingleton);
assert.equal(normalizedDeletedSingleton.layout.blocks.some((block) => block.type === "stats"), false, "Deleted singleton must remain deleted");
assert.equal(canAddBlock(normalizedDeletedSingleton, "stats"), true, "Deleted singleton must become available in the palette");

const emptyLayout = cloneSettings(DEFAULT_SETTINGS);
emptyLayout.layout.blocks = [];
assert.equal(normalizeStartPageSettings(emptyLayout).layout.blocks.length, 0, "An intentionally empty layout must remain empty");

const legacy = {
  schemaVersion: 3,
  startTab: { enabled: false },
  layout: {
    mode: "grid",
    zone: "contained",
    columns: 12,
    rowHeight: 72,
    gap: 14,
    containedMaxWidth: 1280,
    showBlockTitles: true,
    blocks: [
      {
        id: "timer",
        type: "timer",
        enabled: false,
        zone: "contained",
        column: 2,
        row: 3,
        width: 4,
        height: 2,
        order: 0,
        config: { durationSeconds: 90, notifyOnComplete: false },
      },
      {
        id: "note",
        type: "note",
        enabled: true,
        zone: "contained",
        column: 6,
        row: 3,
        width: 3,
        height: 2,
        order: 1,
        config: { placeholder: "Legacy note", confirmDeleteWithContent: true },
      },
      {
        id: "tasks",
        type: "localTasks",
        enabled: true,
        zone: "contained",
        column: 1,
        row: 6,
        width: 4,
        height: 3,
        order: 2,
        config: { placeholder: "Legacy task", showCompleted: true, confirmDeleteWithContent: true },
      },
      {
        id: "links",
        type: "links",
        enabled: true,
        zone: "contained",
        column: 5,
        row: 6,
        width: 4,
        height: 3,
        order: 3,
        config: {
          columns: 2,
          rows: 2,
          pageDirection: "horizontal",
          fontFamily: "system-ui",
          fontSize: 13,
          iconSize: 28,
          items: [{ id: "legacy-link", icon: "L", title: "Legacy", url: "https://example.com" }],
        },
      },
    ],
  },
};

const migrated = normalizeStartPageSettings(legacy);
const migratedTimer = findBlock(migrated, "timer");
assert.equal(migrated.schemaVersion, START_PAGE_SCHEMA_VERSION);
assert.equal(migrated.startTab.enabled, false);
assert.equal(migratedTimer.enabled, false);
assert.equal(migratedTimer.column, 2);
assert.equal(migratedTimer.row, 3);
assert.equal(migratedTimer.width, 4);
assert.equal(migratedTimer.config.durationSeconds, 90);
assert.deepEqual(normalizeStartPageSettings(migrated), migrated, "Migration must be idempotent");

const damaged = normalizeStartPageSettings({
  ...migrated,
  layout: {
    ...migrated.layout,
    columns: -100,
    gap: 9999,
    blocks: [
      { ...migratedTimer, column: -30, row: -4, width: -1, height: 0 },
      { id: "unknown", type: "does-not-exist", config: { arbitrary: true } },
      null,
    ],
  },
});
assert.ok(damaged.layout.columns >= 1);
assert.ok(damaged.layout.gap <= 60);
assert.ok(damaged.layout.blocks.every((block) => block.column >= 1 && block.row >= 1));
assert.ok(damaged.layout.blocks.every((block) => block.width >= 1 && block.height >= 1));
assert.ok(damaged.layout.blocks.every((block) => block.type !== ("does-not-exist" as BlockInstance["type"])));

const legacyRuntime = normalizeRuntimeState({
  clocks: {
    timer: {
      type: "timer",
      running: true,
      startedAt: 10_000,
      elapsedMs: 5_000,
      durationMs: 90_000,
      targetAt: 95_000,
      completionToken: "legacy-token",
    },
  },
  localTasks: [{ id: "old-task", title: "Keep me", done: false, createdAt: 1, updatedAt: 1 }],
  notes: { note: "Keep this note" },
  linkPages: { links: 2 },
}, migrated);
const note = findBlock(migrated, "note");
const tasks = findBlock(migrated, "localTasks");
const links = findBlock(migrated, "links");
assert.ok(legacyRuntime.clocks[migratedTimer.id]);
assert.equal(legacyRuntime.notes[note.id], "Keep this note");
assert.equal(legacyRuntime.tasks[tasks.id]?.[0]?.title, "Keep me");
assert.equal(legacyRuntime.linkPages[links.id], 2);

const clockBlock = createBlockInstance("timer", { config: { type: "timer", durationSeconds: 120, notifyOnComplete: true } });
const idleClock = defaultClockForBlock(clockBlock);
const runningClock = startClockState(idleClock, 100_000);
assert.equal(remainingClockMs(runningClock, 110_000), 110_000);
assert.equal(elapsedClockMs(runningClock, 110_000), 10_000);
assert.equal(elapsedClockMs(runningClock, 90_000), 0, "Moving system time backwards must not create negative elapsed time");
const pausedClock = pauseClockState(runningClock, 115_000);
assert.equal(pausedClock.running, false);
assert.equal(pausedClock.accumulatedMs, 15_000);
assert.equal(remainingClockMs(pausedClock, 500_000), 105_000);

const customThemeId = createThemeId();
assert.ok(customThemeId.startsWith("theme-"));
const themeIssues = [];
const normalizedTheme = normalizeTheme({
  id: customThemeId,
  name: "Fixture",
  builtIn: false,
  schemaVersion: 1,
  background: {
    kind: "effect",
    baseColor: "#000000",
    config: { effect: "aurora", speed: 999, intensity: -3, blur: 9999 },
  },
  tokens: {
    textPrimary: "#ffffff",
    textSecondary: "#aaaaaa",
    cardSurface: "#111111",
    cardBorder: "rgba(255,255,255,.1)",
    cardOpacity: 99,
    shadow: "none",
    accent: "#00ffff",
    hover: "rgba(0,255,255,.1)",
    active: "rgba(0,255,255,.2)",
    fontFamily: "system-ui",
    baseFontSize: 200,
    headingScale: 20,
    borderRadius: 200,
    spacing: 200,
  },
  createdAt: 1,
  updatedAt: 1,
}, cloneTheme(BUILT_IN_THEMES[0]!), "theme", themeIssues);
assert.equal(normalizedTheme.builtIn, false);
assert.ok(normalizedTheme.tokens.cardOpacity <= 1);
assert.ok(normalizedTheme.tokens.baseFontSize <= 32);
assert.ok(normalizedTheme.background.kind === "effect" && normalizedTheme.background.config.intensity <= 1);

const oldBackup = {
  app: "Start Tab",
  version: 3,
  exportedAt: "2026-01-01T00:00:00.000Z",
  storage: {
    startPageSettings: legacy,
    startPageRuntimeState: {
      clocks: { timer: { running: false, elapsedMs: 12_000, durationMs: 90_000 } },
      localTasks: [{ id: "backup-task", title: "Backup task", done: false }],
    },
    blockedSites: ["example.com"],
  },
};
const migratedBackup = migrateBackup(oldBackup);
assert.equal(migratedBackup.version, 4);
assert.equal((migratedBackup.storage.startPageSettings as StartPageSettings).schemaVersion, START_PAGE_SCHEMA_VERSION);
assert.equal((migratedBackup.storage.startPageRuntimeState as { version: number }).version, 2);
assert.deepEqual(migratedBackup.storage.blockedSites, ["example.com"]);

// Storage-backed regression fixtures use a minimal Chrome API mock.
const storageState: Record<string, unknown> = {};
const chromeMock = {
  storage: {
    local: {
      async get(keys?: string | string[]): Promise<Record<string, unknown>> {
        const requested = keys === undefined ? Object.keys(storageState) : Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(requested.filter((key) => Object.prototype.hasOwnProperty.call(storageState, key)).map((key) => [key, storageState[key]]));
      },
      async set(items: Record<string, unknown>): Promise<void> {
        for (const [key, value] of Object.entries(items)) {
          assert.notEqual(value, undefined, `chrome.storage.local.set must not receive undefined for ${key}`);
          storageState[key] = structuredClone(value);
        }
      },
      async remove(keys: string | string[]): Promise<void> {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete storageState[key];
      },
    },
  },
} as unknown as typeof chrome;
Object.defineProperty(globalThis, "chrome", { value: chromeMock, configurable: true });

const futureSettings = { ...cloneSettings(DEFAULT_SETTINGS), schemaVersion: START_PAGE_SCHEMA_VERSION + 10, futureField: { keep: true } };
storageState.startPageSettings = structuredClone(futureSettings);
assert.equal(isFutureStartPageSchema(storageState.startPageSettings), true);
await getStartPageSettings();
assert.deepEqual(storageState.startPageSettings, futureSettings, "Reading a future settings schema must not overwrite it");
await assert.rejects(() => setStartPageSettings(cloneSettings(DEFAULT_SETTINGS)), /newer extension version/);

const timestampSettings = cloneSettings(DEFAULT_SETTINGS);
timestampSettings.updatedAt = 100;
for (const block of timestampSettings.layout.blocks) {
  block.createdAt = 100;
  block.updatedAt = 100;
}
storageState.startPageSettings = structuredClone(timestampSettings);
const originalNow = Date.now;
Date.now = () => 200;
const changedSettings = cloneSettings(timestampSettings);
const timestampTimer = findBlock(changedSettings, "timer");
timestampTimer.config.durationSeconds += 1;
await setStartPageSettings(changedSettings);
const changedStored = storageState.startPageSettings as StartPageSettings;
assert.equal(findBlock(changedStored, "timer").updatedAt, 200, "Changed blocks must receive a fresh updatedAt");
Date.now = () => 300;
await setStartPageSettings(cloneSettings(changedStored));
const unchangedStored = storageState.startPageSettings as StartPageSettings;
assert.equal(findBlock(unchangedStored, "timer").updatedAt, 200, "Unchanged blocks must retain their previous updatedAt");
Date.now = originalNow;

const runtimeSettings = normalizeStartPageSettings(timestampSettings);
const futureRuntime = { version: 99, updatedAt: 123, clocks: { future: { keep: true } }, notes: {}, tasks: {}, linkPages: {} };
storageState[START_PAGE_RUNTIME_KEY] = structuredClone(futureRuntime);
storageState.startTabInstanceState = { keepLegacy: true };
assert.equal(isFutureRuntimeSchema(storageState[START_PAGE_RUNTIME_KEY]), true);
await getStartPageRuntimeState(runtimeSettings);
assert.deepEqual(storageState[START_PAGE_RUNTIME_KEY], futureRuntime, "Reading a future runtime schema must not overwrite it");
assert.deepEqual(storageState.startTabInstanceState, { keepLegacy: true }, "Future runtime reads must not delete legacy side data");
await assert.rejects(() => setStartPageRuntimeState(normalizeRuntimeState(undefined, runtimeSettings)), /newer extension version/);

const backupWithoutStats = migrateBackup(oldBackup);
assert.equal(Object.prototype.hasOwnProperty.call(backupWithoutStats.storage, FOCUS_STATS_KEY), false, "Missing optional focus stats must stay absent instead of becoming undefined");
assert.throws(() => migrateBackup({ ...oldBackup, storage: { ...oldBackup.storage, startPageSettings: futureSettings } }), /newer extension version/);
assert.throws(() => migrateBackup({ ...oldBackup, storage: { ...oldBackup.storage, startPageRuntimeState: futureRuntime } }), /newer extension version/);

const normalizedStats = normalizeFocusStats({
  version: 1,
  totals: {},
  byDay: {},
  byDomain: {},
  processedClockCompletions: Object.fromEntries(Array.from({ length: 700 }, (_, index) => [`token-${index}`, index + 1])),
});
assert.equal(Object.keys(normalizedStats.processedClockCompletions).length, 512, "Clock completion dedupe history must remain bounded");

assert.equal(isMessage({ type: "clock-action", instanceId: "timer-main", action: "toggle" }), true);
assert.equal(isMessage({ type: "complete-clock", instanceId: "timer-main", token: "token" }), true);
assert.equal(isMessage({ type: "reset-clocks" }), true);
assert.equal(isMessage({ type: "reset-stats" }), true);
assert.equal(isMessage({ type: "runtime-note", instanceId: "note-main", value: "draft" }), true);
assert.equal(isMessage({ type: "runtime-link-page", instanceId: "links-main", page: 2 }), true);
assert.equal(isMessage({ type: "delete-instance-runtime", instanceId: "note-main" }), true);
assert.equal(isMessage({ type: "complete-clock", instanceId: "", token: "token" }), false);

console.log("Roadmap fixtures passed");
