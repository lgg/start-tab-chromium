import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const chromeSync = read("src/lib/chrome-sync.ts");
const google = read("src/lib/google-integration.ts");
const integrations = read("src/newtab/block-renderers-integrations.ts");
const options = read("src/options/options.ts");

assert.match(chromeSync, /function isVolatileTimestampField\(path: CanonicalPath, key: string\)/,
  "Browser Sync timestamp removal must be path-aware");
assert.match(chromeSync, /startPageRuntimeState", "tasks", "\*", "\[\]"/,
  "Task entity timestamps must be removed without treating instance IDs as schema fields");
assert.match(chromeSync, /canonicalValue\(value\[key\], \[\.\.\.path, key\]\)/,
  "Canonicalization must carry the complete schema path");
assert.match(chromeSync, /export function previousCanonicalBackupContent/,
  "Previously uploaded v3 checksums must remain verifiable after the canonicalization fix");
assert.match(chromeSync,
  /const rawBundle = value as BackupBundle;[\s\S]*previousCanonicalBackupContent\(rawBundle\)[\s\S]*legacyCanonicalBackupContent\(rawBundle\)[\s\S]*previousCanonicalBackupContent\(bundle\)[\s\S]*legacyCanonicalBackupContent\(bundle\)[\s\S]*acceptedChecksums\.includes\(meta\.contentChecksum\)/,
  "Remote restore must accept validated raw and migrated current, previous-v3, and legacy content checksums");

assert.match(google, /url\.searchParams\.set\("q", normalizedQuery\)/,
  "Calendar query must be sent to Google before applying the configured display limit");
assert.match(google, /nextPageToken/,
  "Filtered Calendar lookup must support API pagination");
assert.match(google, /event\.title\.toLocaleLowerCase\(\)\.includes\(titleQuery\)/,
  "Google's broad q match must remain narrowed to the configured title filter");
assert.match(google, /return events\.slice\(0, limit\)/,
  "Calendar result limits must be applied after title filtering");
assert.match(integrations, /JSON\.stringify\(\[block\.config\.calendarId, block\.config\.maxResults, query\]\)/,
  "Calendar cache identity must include the independent query setting");
assert.match(integrations, /listCalendarEvents\(block\.config\.calendarId, block\.config\.maxResults, query\)/,
  "Calendar renderer must delegate query-before-limit behavior to the integration");
assert.doesNotMatch(integrations, /const filtered = query/,
  "Calendar renderer must not filter an already-truncated result set");

assert.match(options, /MAX_CUSTOM_THEMES, MAX_START_PAGE_BLOCKS/,
  "Options UI must share the persisted custom-theme capacity");
assert.match(options, /duplicate\.disabled = themeCapacityReached/,
  "Theme duplication must stop at the shared capacity before storage rejects it");
assert.match(options, /create\.disabled = themeCapacityReached/,
  "Theme creation must stop at the shared capacity");
assert.match(options, /importButton\.disabled = themeCapacityReached/,
  "Theme import must stop at the shared capacity");
assert.match(options, /async function runAction<T>/,
  "Options actions must preserve typed operation results");
assert.match(options, /successMessage: string \| \(\(result: T\) => string\)/,
  "Success messages must be able to depend on the actual operation result");
assert.match(options, /runAction\(syncChromeSyncBackup, \(result\) => i18n\.t/,
  "Smart Sync must display uploaded/restored/unchanged instead of overwriting it with a generic status");

console.log("Round 21 static validation passed");
