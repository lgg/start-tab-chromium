# Full Project Audit - Instance Refresh

Date: 2026-07-04
Branch: `codex/full-project-audit-instance-refresh-20260704`
Base: `master`

## Scope

This audit pass reviewed the full extension with emphasis on already-open new-tab runtime behavior:

- MV3 service worker, DNR rules, blocked-site navigation, and popup messaging;
- new-tab gate, split-view/native-tab bypass handling, and disabled Start Tab overlay;
- layout editor and block instance editor runtime scripts;
- options UI settings save/reset and storage change propagation;
- timers, stopwatch, pomodoro, local tasks, search, weather, IP, calendar, history, pinned blocks, and stats;
- storage/local runtime state, backup/import/export, Chrome Sync, and Google Drive restore;
- i18n EN/RU fallback behavior;
- manifest permissions and CI/build/typecheck configuration;
- performance risks around MutationObserver, interval startup, repeated fetches, and repeated event handler binding;
- UX and preservation of user settings without requiring manual reloads.

## Finding

`src/newtab/instances.js` patches some block bodies once and marks cards with `data-instance-*` attributes. When `startPageSettings` changed in another tab, the storage listener updated `currentSettings` and scheduled a pass, but the existing `data-instance-*` markers made `patchSearch()`, `patchClock()`, `patchLocalTasks()`, and `patchWeather()` return early.

That caused stale already-open new-tab instances. Examples: changing the search provider or weather location in options could leave the currently open new tab using old submit handlers or old weather data until a manual reload.

## Fix

- Added `clearRuntimePatchMarkers()` to remove only the internal `data-instance-*` patch markers from cards.
- Called it from the `chrome.storage.onChanged` handler before scheduling the runtime refresh.
- Kept persisted runtime state intact: clocks, local tasks, and link pages are still stored under `startTabInstanceState`.

## Safety Notes

The change does not alter storage schema, user settings, or block layout data. It only allows the existing runtime patch functions to re-run after settings changes. Existing debounce and single interval guard remain in place, so this does not add polling or fetch spam during normal rendering.

## CI Notes

The CI workflow runs `npm ci`, `npm run typecheck`, `npm run build`, and `npm run build:blocker-only`. It does not use `actions/upload-artifact` or `actions/cache`, so there is no artifact/cache retention setting to change.

## Remaining Risk

The legacy JS runtime in `src/newtab/instances.js` still duplicates layout defaults from the TypeScript settings module. A future refactor should consolidate that boundary, but this fix intentionally stays minimal and runtime-focused.
