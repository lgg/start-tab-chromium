# Audit 2026-07-04: Instance layout ID normalization

## Scope

Performed a full-project audit pass across the current `master` state after the previous editor layout ID fix. The review covered:

- architecture and responsibility boundaries between shared settings, options UI, new tab runtime, service worker, and plain runtime patch scripts;
- new tab runtime rendering and dynamic block update behavior;
- options UI and layout editor persistence paths;
- site blocking, MV3 declarativeNetRequest synchronization, blocked navigation tracking, and focus statistics;
- timer, stopwatch, pomodoro, notes, local tasks, search, IP, weather, Google Calendar, history, browser pinned tabs, Start Tab pinned links, commands, and stats blocks;
- storage/local state/sync/backup/import/export flows;
- EN/RU i18n key coverage for touched surfaces;
- manifest permissions and MV3 background behavior;
- CI workflow for typecheck and both build modes;
- performance risks around intervals, MutationObserver use, cached async fetches, and repeated storage writes;
- error handling, data normalization, and preservation of user settings/local state.

## Finding

The shared TypeScript settings layer and `src/newtab/editor.js` now normalize layout block IDs so empty or duplicated `layout.blocks[].id` values are repaired before persisting. `src/newtab/instances.js` still had its own local `normalizeSettings()` implementation and direct write paths for adding, removing, duplicating, and configuring blocks. Those paths preserved malformed IDs from an already-corrupted stored layout and could write them back unchanged.

Impact: if imported/synced legacy data or manual JSON edits introduced duplicate or empty block IDs, the instance editor/runtime could continue using ambiguous DOM selectors and storage keys. That can attach controls to the wrong card, skip updates, or mix per-instance runtime state.

## Fix

Updated `src/newtab/instances.js` to normalize layout block IDs before every settings write:

- added the same local block type fallback and unique ID generation pattern used by the layout editor;
- made `normalizeSettings()` pass all layout blocks through `normalizeLayoutBlocks()`;
- preserved existing valid IDs and user block configuration;
- repaired only missing/blank/duplicate IDs with deterministic suffixes in local order.

## Verification

- GitHub connector compare shows the branch is ahead of `master` by one code commit before this report and modifies only `src/newtab/instances.js` for runtime behavior.
- CI workflow was reviewed: it runs `npm ci`, `npm run typecheck`, `npm run build`, and `npm run build:blocker-only` on PRs and pushes to `master`.
- The workflow does not upload artifacts and does not configure cache, so no `retention-days` change is required.

## Remaining risk / technical debt

- `instances.js` and `editor.js` still duplicate a subset of defaults from the TypeScript settings module because they run as plain browser scripts. A future refactor should generate or share a runtime-safe defaults module to remove drift.
- Weather/calendar/network blocks still depend on external APIs/OAuth availability and intentionally degrade to unavailable states when those services fail.
- Full browser-extension interaction testing remains manual; CI currently covers typecheck and build, not end-to-end Chromium behavior.
