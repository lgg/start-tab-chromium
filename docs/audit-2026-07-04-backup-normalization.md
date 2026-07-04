# Full Project Audit - Backup Normalization

Date: 2026-07-04
Branch: `codex/full-project-audit-backup-normalization-20260704`
Base: `master`

## Scope

This audit pass reviewed the full extension surface with emphasis on data paths that can bypass normal UI validation:

- MV3 service worker startup, new-tab override, and DNR blocklist synchronization;
- blocked page unblock flow and focus stats updates;
- options UI save, reset, layout editor, JSON editing, backup controls, Chrome Sync, and Google Drive restore;
- start page runtime blocks: date/time, search, links, timers, stopwatch, pomodoro, note, local tasks, calendar, weather, commands, recent history, browser-pinned, start-pinned, and stats;
- storage keys, runtime state, backup/import/export, sync, and restore behavior;
- i18n EN/RU loading surface;
- manifest permissions and MV3 configuration;
- CI workflow, typecheck/build coverage, and artifact/cache retention requirements;
- performance risks around repeated fetches, intervals, and storage writes;
- security/error handling and preservation of user settings.

## Finding

`setStartPageSettings()` now normalizes settings before writing, but `importBackup()` still wrote imported storage values directly through `chrome.storage.local.set(nextStorage)`.

That meant JSON import, Chrome Sync restore, and Google Drive restore could persist malformed `startPageSettings` again, including invalid layout block IDs or out-of-range values. The UI would often repair those values on later reads, but raw persisted state could still affect code paths that read local storage directly or future migrations.

## Fix

- Added `normalizeStartPageSettings()` to the backup import path.
- Added a small `importStorageValue()` helper to normalize only `startPageSettings` while preserving other storage keys exactly as before.
- Kept backup schema and all storage key names unchanged.

## Safety Notes

Valid user settings remain valid and keep the same schema. The import flow still accepts backup versions 1-3 and still removes missing managed storage keys as before. The change only applies existing settings normalization before imported settings reach persistent storage.

## CI Notes

The CI workflow runs `npm ci`, `npm run typecheck`, `npm run build`, and `npm run build:blocker-only`. It does not use `actions/upload-artifact` or `actions/cache`, so there is no artifact/cache retention setting to change.

## Remaining Risk

`src/newtab/instances.js` still duplicates some layout fallback metadata from `src/lib/start-page-settings.ts`. Consolidating that JS/TS boundary is a larger refactor and was intentionally left out of this minimal audit fix.
