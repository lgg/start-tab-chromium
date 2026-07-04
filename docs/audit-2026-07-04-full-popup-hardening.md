# Full project audit: popup async hardening

Date: 2026-07-04
Branch: `codex/full-project-audit-popup-hardening-20260704`
Base: `master`

## Scope

Reviewed the extension end-to-end: MV3 manifest and permissions, service worker message flow, popup runtime, blocked page runtime, new tab runtime/gate, options UI, layout editor, site blocking, timers, IP/weather/calendar/search/history/pinned blocks, storage/local state/sync/backup/import/export, EN/RU i18n, CI/build/typecheck, performance risks, security/error handling, and user settings preservation.

## Finding

The popup still had unguarded asynchronous paths: initial bootstrap used `void init()` without a rejection handler, language switching used an async event listener without catch handling, clear blocklist could surface render failures as unhandled rejections, and block/unblock could complete the storage/DNR mutation but then fail on `chrome.tabs.reload()`, leaving the popup open even though the requested action had already succeeded.

## Fix

- Added shared popup error formatting and status display helpers.
- Surfaced negative service-worker acknowledgements in the popup note instead of always replacing them with a generic message.
- Wrapped active-tab reload in a best-effort helper so successful block/unblock mutations still close the popup if reload is unavailable.
- Added guarded async flows for clear blocklist, language switching, primary block/unblock actions, and initial popup bootstrap.

## Safety

- No storage schema changes.
- No manifest permission changes.
- No feature removal.
- Existing user settings, backups, sync payloads, local runtime state, and i18n catalogs remain compatible.
- CI workflow has no Actions artifacts/cache retention configuration; `retention-days: 1` is not applicable.

## Remaining risks and technical debt

- `src/newtab/instances.js` still duplicates layout metadata from `src/lib/start-page-settings.ts`.
- Native browser new-tab and split-view support remains best-effort because Chromium-derived browsers expose different internal URLs.
- External IP/weather/calendar providers can fail independently and remain best-effort.
