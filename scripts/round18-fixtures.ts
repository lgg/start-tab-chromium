import assert from "node:assert/strict";

import { importBackup, migrateBackup } from "../src/lib/backup.js";
import { isMessage } from "../src/lib/messages.js";
import {
  MAX_CUSTOM_THEMES,
  MAX_LOCAL_TASKS_PER_INSTANCE,
  MAX_START_PAGE_BLOCKS,
} from "../src/lib/platform-limits.js";
import { normalizeRuntimeState } from "../src/lib/start-page-runtime.js";
import {
  BUILT_IN_THEMES,
  DEFAULT_LAYOUT_BLOCKS,
  DEFAULT_SETTINGS,
  canAddBlock,
  cloneSettings,
  cloneTheme,
  normalizeStartPageSettings,
  prepareStartPageSettingsWrite,
} from "../src/lib/start-page-settings.js";
import type { BlockInstance, LocalTask, StartPageSettings, StartPageTheme } from "../src/lib/start-page-types.js";

function repeatedBlocks(count: number): BlockInstance[] {
  const source = DEFAULT_LAYOUT_BLOCKS.find((block) => block.type === "dateTime");
  assert.ok(source, "Default settings must contain a repeatable Date & Time block");
  return Array.from({ length: count }, (_, index) => ({
    ...structuredClone(source),
    id: `date-time-${index}`,
    order: index,
    row: Math.min(500, index + 1),
  }));
}

function customThemes(count: number): StartPageTheme[] {
  const source = BUILT_IN_THEMES[0];
  assert.ok(source, "At least one built-in theme is required");
  return Array.from({ length: count }, (_, index) => ({
    ...cloneTheme(source),
    id: `custom-${index}`,
    name: `Custom ${index}`,
    builtIn: false,
  }));
}

function tasks(count: number): LocalTask[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `task-${index}`,
    title: `Task ${index}`,
    done: false,
    createdAt: index + 1,
    updatedAt: index + 1,
  }));
}

const maximumSettings = cloneSettings(DEFAULT_SETTINGS);
maximumSettings.layout.mode = "free";
maximumSettings.layout.blocks = repeatedBlocks(MAX_START_PAGE_BLOCKS);
maximumSettings.themes.customThemes = customThemes(MAX_CUSTOM_THEMES);
assert.equal(isMessage({
  type: "replace-start-page-settings",
  settings: maximumSettings,
  expectedSettingsUpdatedAt: 0,
  expectedRuntimeUpdatedAt: 0,
}), true, "The exact supported settings capacity must remain valid");
assert.equal(canAddBlock(maximumSettings, "dateTime"), false,
  "The UI must stop offering new repeatable blocks at the same boundary enforced by messages");

const oversizedBlocks = cloneSettings(maximumSettings);
oversizedBlocks.layout.blocks = repeatedBlocks(MAX_START_PAGE_BLOCKS + 1);
assert.equal(isMessage({
  type: "replace-start-page-settings",
  settings: oversizedBlocks,
  expectedSettingsUpdatedAt: 0,
  expectedRuntimeUpdatedAt: 0,
}), false, "A settings message above the supported block capacity must be rejected");
assert.throws(
  () => prepareStartPageSettingsWrite(oversizedBlocks, DEFAULT_SETTINGS, DEFAULT_SETTINGS.updatedAt),
  /at most 1000 block instances/,
  "Direct settings writes must reject the same oversized block collection instead of silently persisting it",
);
assert.equal(normalizeStartPageSettings(oversizedBlocks).layout.blocks.length, MAX_START_PAGE_BLOCKS,
  "Corrupted local settings must normalize to an editable supported block count");

const oversizedThemes = cloneSettings(DEFAULT_SETTINGS);
oversizedThemes.themes.customThemes = customThemes(MAX_CUSTOM_THEMES + 1);
assert.throws(
  () => prepareStartPageSettingsWrite(oversizedThemes, DEFAULT_SETTINGS, DEFAULT_SETTINGS.updatedAt),
  /at most 1000 custom themes/,
  "Direct settings writes must reject an oversized custom-theme collection",
);
assert.equal(normalizeStartPageSettings(oversizedThemes).themes.customThemes.length, MAX_CUSTOM_THEMES,
  "Corrupted local settings must normalize to the supported custom-theme count");

const taskBlock = DEFAULT_SETTINGS.layout.blocks.find((block) => block.type === "localTasks");
assert.ok(taskBlock, "Default settings must contain a Local Tasks block");
const maximumTasks = tasks(MAX_LOCAL_TASKS_PER_INSTANCE);
const oversizedTasks = tasks(MAX_LOCAL_TASKS_PER_INSTANCE + 1);
assert.equal(isMessage({
  type: "runtime-tasks",
  instanceId: taskBlock.id,
  tasks: maximumTasks,
  expectedTasks: maximumTasks,
}), true, "The exact supported task capacity must remain valid");
assert.equal(isMessage({
  type: "runtime-tasks",
  instanceId: taskBlock.id,
  tasks: oversizedTasks,
  expectedTasks: maximumTasks,
}), false, "Runtime messages above the supported task capacity must be rejected");
const normalizedRuntime = normalizeRuntimeState({
  version: 2,
  updatedAt: 1,
  tasks: { [taskBlock.id]: oversizedTasks },
}, DEFAULT_SETTINGS);
assert.equal(normalizedRuntime.tasks[taskBlock.id]?.length, MAX_LOCAL_TASKS_PER_INSTANCE,
  "Corrupted local runtime must normalize to an editable supported task count");

function backup(storage: Record<string, unknown>): Record<string, unknown> {
  return {
    app: "Start Tab",
    version: 4,
    exportedAt: new Date().toISOString(),
    snapshotId: "round18-capacity",
    storage,
  };
}

assert.throws(
  () => migrateBackup(backup({ startPageSettings: oversizedBlocks })),
  /more than 1000 block instances/,
  "Oversized imported settings must fail before normalization can silently discard blocks",
);
assert.throws(
  () => migrateBackup(backup({ startPageSettings: oversizedThemes })),
  /more than 1000 custom themes/,
  "Oversized imported theme collections must fail before mutation",
);
const regularSettings: StartPageSettings = cloneSettings(DEFAULT_SETTINGS);
assert.throws(
  () => migrateBackup(backup({
    startPageSettings: regularSettings,
    startPageRuntimeState: {
      version: 2,
      updatedAt: 1,
      tasks: { [taskBlock.id]: oversizedTasks },
    },
  })),
  /more than 10000 runtime tasks/,
  "Oversized imported task collections must fail instead of creating uneditable runtime state",
);

let storageCalls = 0;
Object.defineProperty(globalThis, "chrome", {
  configurable: true,
  value: {
    storage: {
      local: {
        async get(): Promise<Record<string, unknown>> { storageCalls += 1; return {}; },
        async set(): Promise<void> { storageCalls += 1; },
        async remove(): Promise<void> { storageCalls += 1; },
      },
    },
    alarms: { async getAll(): Promise<never[]> { storageCalls += 1; return []; } },
    declarativeNetRequest: {
      async getDynamicRules(): Promise<never[]> { storageCalls += 1; return []; },
      async updateDynamicRules(): Promise<void> { storageCalls += 1; },
    },
  },
});
await assert.rejects(
  () => importBackup(backup({
    startPageSettings: regularSettings,
    startPageRuntimeState: {
      version: 2,
      updatedAt: 1,
      tasks: { [taskBlock.id]: oversizedTasks },
    },
  })),
  /more than 10000 runtime tasks/,
  "Oversized backup import must reject before entering the mutation transaction",
);
assert.equal(storageCalls, 0,
  "Oversized backup rejection must happen before storage, DNR, revision, or alarm access");

const migratedAtCapacity = migrateBackup(backup({
  startPageSettings: maximumSettings,
  startPageRuntimeState: {
    version: 2,
    updatedAt: 1,
    tasks: { [taskBlock.id]: maximumTasks },
  },
}));
const migratedSettings = migratedAtCapacity.storage.startPageSettings as StartPageSettings;
assert.equal(migratedSettings.layout.blocks.length, MAX_START_PAGE_BLOCKS);
assert.equal(migratedSettings.themes.customThemes.length, MAX_CUSTOM_THEMES);

console.log("Round 18 fixtures passed");
