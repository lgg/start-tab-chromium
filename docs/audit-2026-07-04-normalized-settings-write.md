# Full Project Audit - Normalized Settings Write

Date: 2026-07-04
Branch: `codex/full-project-audit-normalized-settings-write-20260704`
Base: `master`

## Scope

A full project audit pass covered:

- architecture and responsibility boundaries;
- new tab runtime and initialization flow;
- options UI and manual JSON settings editing;
- layout editor and persisted block identity;
- blocked-site flow and focus stats integration;
- timer, stopwatch, and pomodoro state;
- IP, weather, calendar, search, history, browser-pinned, and start-pinned blocks;
- storage, local state, sync expectations, backup, import, and export;
- EN/RU i18n surface;
- MV3 manifest permissions;
- CI, build, and typecheck configuration;
- performance risks around polling, intervals, MutationObserver usage, and repeated fetches;
- security, error handling, UX, and preservation of existing user settings.

## Finding

`getStartPageSettings()` normalized stored settings on read, but `setStartPageSettings()` wrote the caller-provided object directly back to `chrome.storage.local`.

That left a persistence gap after layout ID normalization: the options UI could read a repaired layout, while manual JSON edits or import/save flows could still persist duplicate or empty `layout.blocks[].id` values. Some runtime code paths read `chrome.storage.local` directly, so malformed persisted layout identity could still leak into new-tab rendering and editor state.

## Fix

- Added `normalizeStartPageSettings(value)` as the central public normalizer.
- Updated `getStartPageSettings()` to use the exported normalizer.
- Updated `setStartPageSettings()` to normalize before writing to storage.

## Safety Notes

The change keeps the existing settings schema and preserves valid user settings. It only clamps and fills values through the already existing merge logic before persistence, including stable layout block ID repair for malformed or duplicated IDs.

## Remaining Risk

`src/newtab/instances.js` still contains runtime-side layout fallback metadata that duplicates parts of `src/lib/start-page-settings.ts`. This was not changed here because consolidating that JS/TS boundary would be broader than the audit fix and should be handled as a separate refactor.
