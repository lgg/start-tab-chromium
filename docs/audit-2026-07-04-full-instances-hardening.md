# Full project audit: new tab instances async hardening

Date: 2026-07-04
Branch: `codex/full-project-audit-instances-hardening-20260704`
Base: `master`

## Scope

Reviewed the project end-to-end: MV3 manifest and permissions, service worker flow, popup and blocked page runtimes, new tab runtime/gate, block instance runtime, options UI, layout editor, site blocking, timers/stopwatch/pomodoro, IP/weather/calendar/search/history/pinned blocks, storage/local state/sync/backup/import/export, EN/RU i18n, CI/build/typecheck, performance risks from polling/fetch/MutationObserver/interval usage, security/error handling, and user settings preservation.

## Finding

`src/newtab/instances.js` still had several fire-and-forget async paths without rejection handling. Layout editor block actions, clock controls, local task mutations, the 1-second dynamic tick, and the scheduled runtime override callback could reject if `chrome.storage.local` failed, if state normalization encountered unexpected data, or if a runtime patch failed. Those failures could become unhandled promise rejections and stop the progressive instance overlay from applying cleanly.

## Fix

- Added a shared `runRuntimeAction()` wrapper for instance runtime actions.
- Guarded layout editor add/configure/duplicate/remove actions.
- Guarded timer/stopwatch/pomodoro control buttons.
- Guarded local task checkbox and submit mutations.
- Guarded the dynamic `tick()` interval.
- Guarded the scheduled runtime override callback created by the MutationObserver/debounce path.

## Safety

- No storage schema changes.
- No manifest permission changes.
- No feature removal.
- Existing user settings, layout state, instance state, backups, and sync payloads remain compatible.
- CI workflow has no Actions artifacts/cache retention configuration; `retention-days: 1` is not applicable.

## Remaining risks and technical debt

- `src/newtab/instances.js` still duplicates layout metadata from `src/lib/start-page-settings.ts`; this should eventually be consolidated or generated from one source.
- Native browser new-tab and split-view support remains browser-specific best-effort behavior.
- External IP/weather/calendar providers can fail independently and are handled as best-effort UI.
