# Full Project Audit - Static Helper Guards

Date: 2026-07-04
Branch: `codex/full-project-audit-static-helper-guards-20260704`
Base: `master`

## Scope

A full project audit pass was performed across the extension surface:

- architecture and responsibility boundaries;
- new tab runtime and progressive helper scripts;
- options/settings UI and progressive option helpers;
- layout editor and block instance controls;
- site blocking flow and DNR synchronization;
- timers, stopwatch, and pomodoro behavior;
- IP, weather, calendar, search, history, browser pinned, and Start Tab pinned blocks;
- storage, local state, sync, backup, import, and export;
- EN/RU i18n touchpoints;
- Manifest V3 permissions and extension entry points;
- CI, build, and typecheck workflow;
- performance risks from polling, repeated fetches, MutationObserver usage, intervals, and repeated requests;
- security, defensive error handling, and user settings preservation.

## Finding

Two static helper scripts are copied into the extension build without TypeScript checking:

- `src/newtab/editor.js`;
- `src/options/background-presets.js`.

Both files intentionally use fire-and-forget async UI actions for optional enhancements. Several of those actions wrote to `chrome.storage.local`, opened the options page, re-rendered preset state, or restored preserved preset metadata after the typed options form saved.

If a storage operation failed, the page was closed mid-operation, or a browser API rejected, the rejection could be unhandled in the page context. The main settings schema was not corrupted, but optional helpers could fail noisily and make debugging runtime issues harder.

## Fix

Added small local guard wrappers:

- `runEditorAction` in `src/newtab/editor.js`;
- `runPresetAction` in `src/options/background-presets.js`.

The wrappers catch synchronous throws and promise rejections for optional helper actions. Guarded actions now include:

- opening block settings from the layout editor;
- layout mode, zone, title visibility, block enable toggles, and drag/resize saves;
- layout editor initialization;
- background preset selection, like/unlike, removal, and add/upload flows;
- deferred background preset restoration after the core options form save;
- scheduled background preset manager rendering.

No storage keys, backup schema, i18n keys, layout semantics, or existing features were changed.

## CI / Build Review

`.github/workflows/ci.yml` was reviewed again. It runs:

- `npm ci`;
- `npm run typecheck`;
- `npm run build`;
- `npm run build:blocker-only`.

No GitHub Actions artifact upload or explicit dependency cache is configured, so `retention-days: 1` is not applicable.

## Remaining Risks

- These helper scripts are still plain JavaScript copied as static assets. A future hardening pass should migrate them into typed entry points so CI can catch syntax/type regressions earlier.
- The current change intentionally keeps the fix narrow to avoid changing user settings, local state, backup/import/export behavior, or layout data shape.
