import assert from "node:assert/strict";
import { migrateBackup } from "../src/lib/backup.js";
import {
  DEFAULT_SETTINGS,
  cloneSettings,
  createBlockInstance,
  createThemeId,
} from "../src/lib/start-page-defaults.js";
import {
  defaultClockForBlock,
  elapsedClockMs,
  normalizeRuntimeState,
  pauseClockState,
  remainingClockMs,
  startClockState,
} from "../src/lib/start-page-runtime.js";
import {
  START_PAGE_SCHEMA_VERSION,
  canAddBlock,
  cloneBlock,
  normalizeStartPageSettings,
  normalizeTheme,
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
assert.equal(clean.version, START_PAGE_SCHEMA_VERSION);
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

const legacy = {
  version: 3,
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
assert.equal(migrated.version, START_PAGE_SCHEMA_VERSION);
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

const baseTheme = clean.themes.customThemes[0] ?? {
  ...structuredClone(DEFAULT_SETTINGS.themes),
};
void baseTheme;
const customThemeId = createThemeId();
assert.ok(customThemeId.startsWith("theme-"));
const themeIssues = [];
const normalizedTheme = normalizeTheme({
  id: customThemeId,
  name: "Fixture",
  builtIn: false,
  version: 1,
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
}, undefined, "theme", themeIssues);
assert.equal(normalizedTheme.builtIn, false);
assert.ok(normalizedTheme.tokens.cardOpacity <= 1);
assert.ok(normalizedTheme.tokens.baseFontSize <= 32);
assert.ok(normalizedTheme.background.kind === "effect" && normalizedTheme.background.config.intensity <= 1);
assert.ok(themeIssues.length > 0, "Out-of-range theme values should produce validation issues");

const oldBackup = {
  app: "start-tab-chromium",
  version: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
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
assert.equal((migratedBackup.storage.startPageSettings as StartPageSettings).version, START_PAGE_SCHEMA_VERSION);
assert.equal((migratedBackup.storage.startPageRuntimeState as { version: number }).version, 2);
assert.deepEqual(migratedBackup.storage.blockedSites, ["example.com"]);

console.log("Roadmap fixtures passed");
