import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [syncSource, googleSource, newtabSource, planSource, contextSource, commonSource, runtimeSource, integrationsSource, packageJson] = await Promise.all([
  readFile(new URL("../src/lib/chrome-sync.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/google-integration.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/newtab/newtab.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/newtab/storage-change-plan.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/newtab/block-renderer-types.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/newtab/block-renderer-common.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/newtab/block-renderers-runtime.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/newtab/block-renderers-integrations.ts", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

assert.match(syncSource, /QUOTA_BYTES(?!_PER_ITEM)/, "Browser Sync must enforce the total runtime quota");
assert.match(syncSource, /chromeSyncStorageBytes\(finalState\)/, "The eventual remote state must be checked before writing");
assert.match(syncSource, /staleRemovedBeforeWrite/, "Temporary quota pressure must use recoverable stale-chunk cleanup");
assert.match(syncSource, /stale-chunk rollback was incomplete/, "A failed upload must report incomplete stale-chunk rollback");
assert.match(googleSource, /orderBy", "modifiedTime desc"/, "Drive lookup must prefer the latest backup");
assert.match(googleSource, /pageSize", "1"/, "Drive lookup must request only the deterministic latest backup");
assert.match(newtabSource, /planStartPageStorageChange/, "New-tab storage events must use the mixed-change planner");
assert.doesNotMatch(newtabSource, /externalSettingsChangeIgnored"\)\);\s*return;/, "An ignored settings change must not discard runtime/stat changes");
assert.match(planSource, /changes\.runtime \|\| changes\.focusStats/, "Runtime and focus refreshes must remain independent from settings drafts");
assert.match(contextSource, /reportError: \(error: unknown\) => void/, "Block actions need a visible error channel");
assert.match(commonSource, /onError\?\.\(error\)/, "Action buttons must route rejected promises to the supplied reporter");
assert.match(runtimeSource, /context\.reportError\(error\)/, "Automatic clock completion failures must be visible");
assert.match(integrationsSource, /context\.reportError/, "Command block failures must be visible");
const parsedPackage = JSON.parse(packageJson);
assert.match(parsedPackage.scripts.test, /run-round13-fixtures/);
assert.match(parsedPackage.scripts.test, /validate-round13-static/);

console.log("Round 13 static validation passed");
