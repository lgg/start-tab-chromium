import assert from "node:assert/strict";
import { OptionsActionGuard } from "../src/options/action-guard.js";

let storage: Record<string, unknown> = {};
const alarms = new Map<string, chrome.alarms.Alarm>();

function clone<T>(value: T): T {
  return structuredClone(value);
}

function keysFor(request?: string | string[] | Record<string, unknown> | null): string[] {
  if (request == null) return Object.keys(storage);
  if (typeof request === "string") return [request];
  return Array.isArray(request) ? request : Object.keys(request);
}

function selected(request?: string | string[] | Record<string, unknown> | null): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keysFor(request)) {
    if (Object.prototype.hasOwnProperty.call(storage, key)) result[key] = clone(storage[key]);
    else if (request && typeof request === "object" && !Array.isArray(request)) result[key] = clone(request[key]);
  }
  return result;
}

const chromeMock = {
  runtime: {
    sendMessage: async () => ({ ok: true }),
    getURL: (path: string) => `chrome-extension://round40/${path}`,
  },
  storage: {
    local: {
      get: async (request?: string | string[] | Record<string, unknown> | null) => selected(request),
      set: async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) storage[key] = clone(value);
      },
      remove: async (request: string | string[]) => {
        for (const key of Array.isArray(request) ? request : [request]) delete storage[key];
      },
    },
  },
  alarms: {
    getAll: async () => clone([...alarms.values()]),
    clear: async (name: string) => alarms.delete(name),
    create: async (name: string, info: chrome.alarms.AlarmCreateInfo) => {
      alarms.set(name, { name, scheduledTime: info.when ?? Date.now() } as chrome.alarms.Alarm);
    },
  },
} as unknown as typeof chrome;
Object.defineProperty(globalThis, "chrome", { value: chromeMock, configurable: true });

const settingsApi = await import("../src/lib/start-page-settings.js");
const runtimeApi = await import("../src/lib/start-page-runtime.js");
const messages = await import("../src/lib/messages.js");

const guard = new OptionsActionGuard();
assert.equal(guard.tryStart(), true, "The first Options mutation must acquire the single-flight guard");
assert.equal(guard.tryStart(), false, "A duplicate Options mutation must be rejected while the first is active");
assert.equal(guard.pending, true);
guard.finish();
assert.equal(guard.pending, false);
assert.equal(guard.tryStart(), true, "The guard must recover after settlement");
guard.finish();

const settings = settingsApi.createDefaultStartPageSettings(100);
const block = settings.layout.blocks.find((candidate) => candidate.id === "timer-main");
assert.ok(block, "Default settings must include timer-main");
storage = { startPageSettings: settings, startTabDataRevision: { version: 1, updatedAt: 100 } };
const staleBlock = clone(block);
await settingsApi.updateBlockInstance(block.id, (current) => ({ ...current, title: "External block edit" }));
await assert.rejects(
  () => settingsApi.updateBlockInstance(block.id, (current) => ({ ...current, title: "Stale dialog edit" }), staleBlock.updatedAt),
  /block changed in another extension context/,
  "A stale Options block dialog must not overwrite a newer block",
);
await assert.rejects(
  () => settingsApi.setBlockEnabled(block.id, !staleBlock.enabled, staleBlock.updatedAt),
  /block changed in another extension context/,
  "A stale Enable/Disable button must not invert newer state",
);
const blockCount = (await settingsApi.getStartPageSettings()).layout.blocks.length;
await assert.rejects(
  () => settingsApi.duplicateBlockInstance(block.id, undefined, staleBlock.updatedAt),
  /block changed in another extension context/,
  "A stale Duplicate button must not duplicate an unseen newer block",
);
assert.equal((await settingsApi.getStartPageSettings()).layout.blocks.length, blockCount);

const themeDraft = settingsApi.createCustomThemeDraft(await settingsApi.getStartPageSettings(), "Round 40 theme");
const savedTheme = await settingsApi.saveNewCustomTheme(themeDraft);
const staleTheme = clone(savedTheme);
await settingsApi.updateCustomTheme({ ...savedTheme, name: "External theme edit" });
await assert.rejects(
  () => settingsApi.updateCustomTheme({ ...staleTheme, name: "Stale theme dialog" }, staleTheme.updatedAt),
  /theme changed in another extension context/,
  "A stale theme dialog must not overwrite a newer theme",
);
await assert.rejects(
  () => settingsApi.duplicateTheme(staleTheme.id, undefined, staleTheme.updatedAt),
  /theme changed in another extension context/,
  "A stale theme card must not duplicate a newer theme snapshot",
);
await assert.rejects(
  () => settingsApi.deleteCustomTheme(staleTheme.id, staleTheme.updatedAt),
  /theme changed in another extension context/,
  "A stale theme confirmation must not delete a newer theme",
);
const currentTheme = (await settingsApi.getStartPageSettings()).themes.customThemes.find((candidate) => candidate.id === staleTheme.id);
assert.equal(currentTheme?.name, "External theme edit");
assert.ok(currentTheme);
await settingsApi.deleteCustomTheme(currentTheme.id, currentTheme.updatedAt);
await assert.rejects(
  () => settingsApi.updateCustomTheme({ ...staleTheme, name: "Resurrected stale theme" }, staleTheme.updatedAt),
  /changed or was removed/,
  "A stale theme dialog must not recreate a theme deleted elsewhere",
);
await assert.rejects(
  () => settingsApi.duplicateTheme(staleTheme.id, undefined, staleTheme.updatedAt),
  /changed or was removed/,
  "A stale theme card must not duplicate a fallback theme after its source was deleted",
);

const runtimeSettings = await settingsApi.getStartPageSettings();
const note = runtimeSettings.layout.blocks.find((candidate) => candidate.type === "note");
assert.ok(note && note.type === "note", "Default settings must include a note block");
const runtime = runtimeApi.normalizeRuntimeState(undefined, runtimeSettings);
runtime.updatedAt = 500;
runtime.notes[note.id] = "newer runtime data";
storage.startPageSettings = clone(runtimeSettings);
storage.startPageRuntimeState = clone(runtime);
storage.startTabDataRevision = { version: 1, updatedAt: 500 };
await assert.rejects(
  () => runtimeApi.deleteInstanceRuntime(note.id, note.updatedAt, 499),
  /runtime changed in another extension context/,
  "Clear instance data must reject a stale runtime snapshot",
);
assert.equal((storage.startPageRuntimeState as typeof runtime).notes[note.id], "newer runtime data");
await assert.rejects(
  () => runtimeApi.deleteInstanceRuntime(note.id, note.updatedAt - 1, runtime.updatedAt),
  /block changed or was removed/,
  "Clear instance data must reject a stale block snapshot",
);
assert.equal((storage.startPageRuntimeState as typeof runtime).notes[note.id], "newer runtime data");
await runtimeApi.deleteInstanceRuntime(note.id, note.updatedAt, runtime.updatedAt);
assert.equal((storage.startPageRuntimeState as typeof runtime).notes[note.id], undefined,
  "Clear instance data must still work for the exact current block/runtime revisions");

assert.equal(messages.isMessage({ type: "delete-instance-runtime", instanceId: note.id }), false,
  "Runtime deletion messages without concurrency revisions must be rejected");
assert.equal(messages.isMessage({
  type: "delete-instance-runtime",
  instanceId: note.id,
  expectedBlockUpdatedAt: note.updatedAt,
  expectedRuntimeUpdatedAt: runtime.updatedAt,
}), true);

console.log("Round 40 fixtures passed");
