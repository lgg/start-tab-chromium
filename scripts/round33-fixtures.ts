import assert from "node:assert/strict";
import { isMessage } from "../src/lib/messages.js";
import { MAX_NOTE_LENGTH } from "../src/lib/platform-limits.js";
import { normalizeRuntimeState } from "../src/lib/start-page-runtime.js";
import { createDefaultStartPageSettings } from "../src/lib/start-page-settings.js";
import { safeWebUrl } from "../src/lib/start-page-validation-primitives.js";

const settings = createDefaultStartPageSettings(1);
const note = settings.layout.blocks.find((block) => block.type === "note");
assert.ok(note, "Default settings must contain a note block for runtime normalization coverage");

const oversized = "n".repeat(MAX_NOTE_LENGTH + 37);
const normalized = normalizeRuntimeState({
  version: 2,
  updatedAt: 1,
  notes: { [note.id]: oversized },
}, settings);
assert.equal(normalized.notes[note.id]?.length, MAX_NOTE_LENGTH,
  "Recovered note data must use the same public note limit as the editor and message boundary");

assert.equal(isMessage({
  type: "runtime-note",
  instanceId: note.id,
  value: "n".repeat(MAX_NOTE_LENGTH),
  expectedValue: "",
}), true, "The exact public note capacity must be accepted");
assert.equal(isMessage({
  type: "runtime-note",
  instanceId: note.id,
  value: "n".repeat(MAX_NOTE_LENGTH + 1),
  expectedValue: "",
}), false, "Oversized note messages must be rejected rather than silently truncated");

for (const value of ["chrome://settings", "chrome-extension://example/page.html", "javascript:alert(1)", "file:///tmp/start-tab"]) {
  assert.equal(safeWebUrl(value), null, `Privileged URL must not become a clickable Start Tab item: ${value}`);
}
assert.equal(safeWebUrl(" https://example.com/path "), "https://example.com/path");

console.log("Round 33 fixtures passed");
