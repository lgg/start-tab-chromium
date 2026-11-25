import assert from "node:assert/strict";
import {
  normalizeStartPageSettings,
  updateBlockInstance,
  updateCustomTheme,
} from "../src/lib/start-page-settings.js";
import { normalizeRuntimeState } from "../src/lib/start-page-runtime.js";
import { MAX_GRID_ROW } from "../src/lib/platform-limits.js";

const longId = "a".repeat(160);
const reserved = longId.slice(0, 158) + "-2";
const legacy = longId + "-2";
const input = {
  schemaVersion: 4,
  layout: {
    mode: "free",
    blocks: [longId, longId, reserved, legacy].map((id, index) => ({
      id, type: "note", title: "Note " + index, row: MAX_GRID_ROW,
    })),
  },
  themes: {
    selectedThemeId: legacy,
    customThemes: [longId, longId, reserved, legacy].map((id, index) => ({
      id, name: "Theme " + index,
    })),
  },
};
const normalized = normalizeStartPageSettings(input);
const ids = normalized.layout.blocks.map((b) => b.id);
const themeIds = normalized.themes.customThemes.map((t) => t.id);
assert.equal(new Set(ids).size, 4);
assert.equal(new Set(themeIds).size, 4);
assert.deepEqual(ids, [longId, longId.slice(0, 158) + "-3", reserved, legacy]);
assert.deepEqual(themeIds, ids, "Theme and block normalization must preserve explicit IDs and bound generated suffixes");
assert.equal(normalized.themes.selectedThemeId, legacy, "Previously generated long theme IDs must remain selectable");
assert.deepEqual(normalizeStartPageSettings(normalized), normalized, "Normalization must be idempotent");
assert.equal(normalized.layout.blocks[0]!.free.y, 100000, "Derived free-mode fallback must obey its upper bound");
const remaining = normalizeStartPageSettings({
  ...normalized,
  layout: { ...normalized.layout, blocks: normalized.layout.blocks.slice(1) },
  themes: { ...normalized.themes, customThemes: normalized.themes.customThemes.slice(1) },
});
assert.deepEqual(remaining.layout.blocks.map((b) => b.id), ids.slice(1));
assert.deepEqual(remaining.themes.customThemes.map((t) => t.id), themeIds.slice(1));
assert.equal(remaining.themes.selectedThemeId, legacy);
const runtime = normalizeRuntimeState({ version: 2, notes: { [legacy]: "must survive" } }, remaining);
assert.equal(runtime.notes[legacy], "must survive", "Removing another block must not detach legacy-suffixed note data");

// Freeze the wall clock so two different edits can occur in the exact same
// millisecond. Their optimistic per-entity revisions must still differ.
const fixed = 1_700_000_000_000;
const stored: Record<string, unknown> = {
  startPageSettings: normalizeStartPageSettings({
    schemaVersion: 4,
    updatedAt: fixed - 10,
    layout: { mode: "free", blocks: [{ type: "note", id: "note", updatedAt: fixed, createdAt: fixed }] },
    themes: { selectedThemeId: "custom", customThemes: [{ id: "custom", name: "Original", updatedAt: fixed, createdAt: fixed }] },
  }),
  startTabDataRevision: { version: 1, updatedAt: fixed - 10 },
};
const chromeMock = {
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        const selected = keys == null ? Object.keys(stored) : typeof keys === "string" ? [keys] : keys;
        return Object.fromEntries(selected.filter((key) => Object.hasOwn(stored, key)).map((key) => [key, structuredClone(stored[key])]));
      },
      set: async (values: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(values)) stored[key] = structuredClone(value);
      },
      remove: async (keys: string | string[]) => {
        for (const key of typeof keys === "string" ? [keys] : keys) delete stored[key];
      },
    },
  },
};
Object.defineProperty(globalThis, "chrome", { value: chromeMock, configurable: true });
const originalNow = Date.now;
Date.now = () => fixed;
try {
  const initial = normalizeStartPageSettings(stored.startPageSettings);
  const theme = initial.themes.customThemes[0]!;
  const block = initial.layout.blocks[0]!;
  const firstBlock = await updateBlockInstance(block.id, (current) => ({ ...current, title: "New note" }), block.updatedAt);
  assert.ok(firstBlock.updatedAt > block.updatedAt, "A block edit must advance an imported entity revision even when root time equals it");
  await assert.rejects(() => updateBlockInstance(block.id, (current) => ({ ...current, title: "Stale note" }), block.updatedAt), /changed or was removed/);
  const firstTheme = await updateCustomTheme({ ...theme, name: "New theme" }, theme.updatedAt);
  assert.ok(firstTheme.updatedAt > theme.updatedAt, "A same-millisecond theme edit must advance the revision");
  await assert.rejects(() => updateCustomTheme({ ...theme, name: "Stale theme" }, theme.updatedAt), /changed or was removed/);
  const saved = normalizeStartPageSettings(stored.startPageSettings);
  assert.equal(saved.layout.blocks[0]!.title, "New note");
  assert.equal(saved.themes.customThemes[0]!.name, "New theme");
} finally {
  Date.now = originalNow;
  Reflect.deleteProperty(globalThis, "chrome");
}
console.log("Round 54 stable entity identity and monotonic revision fixtures passed");
