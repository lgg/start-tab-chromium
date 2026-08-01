import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const runtimeTarget = read("src/lib/runtime-mutation-target.ts");
const worker = read("src/service-worker.ts");
const layoutEditor = read("src/newtab/layout-editor.ts");
const packageJson = JSON.parse(read("package.json"));
const workflow = read(".github/workflows/ci.yml");
const selfHosted = read("scripts/validate-self-hosted-ci.mjs");
const manualQa = read("docs/manual-qa-round39.md");
const audit = read("docs/audit-2026-08-01-round-39.md");

assert.match(runtimeTarget, /RuntimeMutationTargetKind = "clock" \| "note" \| "tasks" \| "linkPage"/);
assert.match(runtimeTarget, /case "clock":[\s\S]*block\.type === "timer"[\s\S]*block\.type === "stopwatch"[\s\S]*block\.type === "pomodoro"/);
assert.match(worker, /performClockAction[\s\S]*assertRuntimeMutationTarget\(settings, instanceId, "clock"\)/,
  "Direct clock actions must validate the current block type inside the runtime transaction");
assert.match(layoutEditor, /export function shouldRefreshLayoutDraft\(active: boolean, dirty: boolean, savePending: boolean\)/);
assert.match(layoutEditor, /return !active \|\| \(!dirty && !savePending\)/);
assert.match(layoutEditor, /const refreshDraft = shouldRefreshLayoutDraft\(this\.active, this\.dirty, this\.savePending\)/);
assert.match(layoutEditor, /if \(refreshDraft\) this\.draft = cloneSettings\(settings\)/,
  "A clean active editor must refresh both its saved baseline and editable draft");
assert.match(layoutEditor, /if \(!this\.active \|\| this\.savePending\) return;[\s\S]*this\.savePending = true/,
  "Layout save must be single-flight");
assert.match(layoutEditor, /finally \{[\s\S]*this\.savePending = false;[\s\S]*this\.renderControls\(\);[\s\S]*this\.options\.requestRender\(\)/,
  "Layout controls must recover after both successful and failed saves");
assert.match(layoutEditor, /const expectedSettingsUpdatedAt = this\.saved\.updatedAt;[\s\S]*this\.saved\.updatedAt !== expectedSettingsUpdatedAt/,
  "A block settings dialog must not apply a stale result over a refreshed external baseline");
assert.match(layoutEditor, /if \(!this\.active \|\| this\.savePending\) return;[\s\S]*card\.classList\.add\("card--editing"\)/,
  "Card mutation controls must disappear while a save is in flight");

for (const command of ["node scripts/run-round39-fixtures.mjs", "node scripts/validate-round39-static.mjs"]) {
  assert.ok(packageJson.scripts.test.includes(command), `npm test must include ${command}`);
  assert.ok(workflow.includes(command), `CI must include ${command}`);
  assert.ok(selfHosted.includes(command), `Self-hosted contract must include ${command}`);
}
for (const phrase of [
  "Timer, Stopwatch, or Pomodoro",
  "external settings change while the editor is open but still clean",
  "double-activate Save layout",
  "block settings dialog is open",
]) assert.ok(manualQa.includes(phrase), `Manual QA is missing: ${phrase}`);
for (const phrase of ["clock targets", "clean active layout draft", "single-flight", "dialog result"]) {
  assert.ok(audit.includes(phrase), `Round 39 audit report is missing: ${phrase}`);
}

console.log("Round 39 static validation passed");
