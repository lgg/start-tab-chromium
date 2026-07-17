import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [settings, runtime, messages, worker, editor, newtab, options, packageJson] = await Promise.all([
  readFile(new URL("../src/lib/start-page-settings.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/start-page-runtime.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/messages.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/service-worker.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/newtab/layout-editor.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/newtab/newtab.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/options/options.ts", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

assert.match(settings, /settingsWithLayoutPreset/);
assert.match(settings, /available\.findIndex\(\(block\) => block\.type === spec\.type\)/,
  "Preset application must reuse retained block identities");
assert.doesNotMatch(settings, /export async function applyLayoutPreset/,
  "The old settings-only preset mutation must not return");
assert.doesNotMatch(settings, /export async function removeBlockInstance/,
  "The old settings-only block deletion must not return");
assert.doesNotMatch(settings, /export async function resetStartPageSettings/,
  "The obsolete settings-only reset path must not return");
assert.match(runtime, /replaceStartPageSettingsWithRuntime/);
assert.match(runtime, /expectedRuntimeUpdatedAt/,
  "Destructive layout replacement must carry a runtime concurrency precondition");
assert.match(runtime, /removesBlockIds[\s\S]*previousRuntime\.updatedAt[\s\S]*expectedRuntimeUpdatedAt/,
  "Runtime concurrency must be checked whenever block IDs are removed");
assert.match(runtime, /commitStorageMutationWithRevision\([\s\S]*START_PAGE_SETTINGS_KEY[\s\S]*START_PAGE_RUNTIME_KEY[\s\S]*LEGACY_INSTANCE_RUNTIME_KEY/,
  "Layout replacement must commit settings, runtime, legacy cleanup, and revision together");
assert.match(runtime, /reconcileClockAlarmsForRuntime\(runtime\)/,
  "Layout replacement must reconcile durable alarms inside the transaction");
assert.match(runtime, /restoreClockAlarmSnapshot\(previousAlarms\)/,
  "Layout replacement must restore alarms after failure");
assert.match(messages, /replace-start-page-settings/);
assert.match(messages, /expectedRuntimeUpdatedAt/);
assert.match(worker, /case "replace-start-page-settings"/);
for (const source of [editor, newtab, options]) {
  assert.match(source, /type: "replace-start-page-settings"/,
    "Every layout-replacement UI must delegate the atomic operation to the service worker");
}
assert.doesNotMatch(editor, /setStartPageSettings\(this\.draft\)/,
  "Layout Editor must not persist settings before runtime/alarm cleanup");
assert.match(editor, /destructiveRuntimeUpdatedAt/,
  "Layout Editor must retain the runtime timestamp from the first destructive confirmation");
assert.match(editor, /expectedRuntimeUpdatedAt: this\.destructiveRuntimeUpdatedAt \?\? this\.options\.getRuntime\(\)\.updatedAt/,
  "Layout Editor save must not replace the confirmation timestamp with a later automatic refresh");
assert.doesNotMatch(options, /removeBlockInstance|applyLayoutPreset/,
  "Options must not use settings-only destructive layout helpers");
const parsed = JSON.parse(packageJson);
assert.match(parsed.scripts.test, /run-round15-fixtures/);
assert.match(parsed.scripts.test, /validate-round15-static/);

console.log("Round 15 static validation passed");
