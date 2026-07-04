# Full project audit: options async hardening

Date: 2026-07-04
Branch: `codex/full-project-audit-options-hardening-20260704`
Base: `master`

## Scope

Reviewed the full extension surface: MV3 manifest and permissions, service worker, new tab runtime and gate overlay, options UI, layout editor, site blocking, timer/stopwatch/pomodoro, IP/weather/calendar/search/history/pinned blocks, storage/local state/sync/backup/import/export, EN/RU i18n, CI/build/typecheck configuration, performance risks from polling/fetch/MutationObserver/interval usage, security/error handling, and user settings preservation.

## Finding

The options page had several user-triggered asynchronous actions launched without a shared rejection guard. This included generic option action buttons such as backup export/import, blocklist clearing, diagnostic Start Tab opening, and layout preset actions. The reset button and initial options-page bootstrap also did not have explicit top-level rejection handling. If a Chrome API, storage operation, backup import, or initialization promise rejected, the user could get no status feedback and the page could produce an unhandled rejection.

## Fix

- Added a shared `showActionError()` helper for options-page async failures.
- Updated `actionButton()` to disable the clicked button while its handler is pending, catch rejected promises, and surface the error in the existing status area.
- Wrapped reset settings in the same guarded async pattern.
- Added a `.catch(showActionError)` guard to initial options-page bootstrap.

## Safety

- No storage schema changes.
- No manifest permission changes.
- No feature removal.
- Existing user settings, backup format, sync format, and local runtime state remain compatible.
- CI workflow has no artifacts/cache retention configuration; `retention-days: 1` is not applicable.

## Remaining risks and technical debt

- `src/newtab/instances.js` still duplicates some default layout metadata from `src/lib/start-page-settings.ts`; future block additions should keep both paths synchronized or consolidate the source of truth.
- Browser-specific native new tab and split-view behavior still depends on Chromium-derived browser internals, although runtime failures now fail safely.
- External IP/weather/calendar providers can fail independently of extension code; current behavior should remain best-effort with user-visible settings.
