# Full Project Audit - Chrome Sync Byte Chunks

Date: 2026-07-04
Branch: `codex/full-project-audit-sync-byte-chunks-20260704`
Base: `master`

## Scope

A full project audit pass was performed across:

- architecture and responsibility boundaries;
- new tab runtime and dynamic block updates;
- options/settings UI and layout editor behavior;
- site blocking flow and DNR synchronization;
- timers, stopwatch, pomodoro, and focus stats recording;
- IP, weather, calendar, search, history, browser pinned, and Start Tab pinned blocks;
- storage, local state, Chrome sync, backup, import, export, and Google Drive backup;
- EN/RU i18n and user-provided text handling;
- Manifest V3 permissions and extension entry points;
- CI, build, and typecheck workflow;
- performance risks from polling, repeated fetches, MutationObserver usage, intervals, and repeated requests;
- security, defensive error handling, and user settings preservation.

## Finding

`src/lib/chrome-sync.ts` split serialized backup JSON by JavaScript string length before storing chunks in `chrome.storage.sync`.

Chrome sync item quota is byte-based, not character-based. Backups containing Cyrillic text, emoji, or other multi-byte UTF-8 characters could produce a chunk that stayed under the old `7000` character limit but exceeded the browser sync per-item byte limit. In that case Chrome sync upload could fail even though the backup appeared to fit within the configured chunk count.

## Fix

Replaced character-count chunking with `chunkForChromeSync`, which uses `TextEncoder` and keeps every chunk under the configured UTF-8 byte budget.

The metadata format, checksum behavior, chunk keys, restore flow, storage keys, backup schema, and user data shape remain unchanged. Existing backups can still be restored because restore continues to read the same chunk key format and validate the joined JSON checksum.

## CI / Build Review

`.github/workflows/ci.yml` was reviewed again. It runs `npm ci`, `npm run typecheck`, `npm run build`, and `npm run build:blocker-only`.

No GitHub Actions artifact upload or explicit dependency cache is configured, so `retention-days: 1` is not applicable.

## Remaining Risks

- Very large backups can still exceed the total Chrome sync budget and should continue to use JSON export or Google Drive backup.
- Chrome sync quota enforcement may include browser-specific overhead, so the byte chunk budget intentionally remains conservative.
