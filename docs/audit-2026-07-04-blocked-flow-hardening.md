# Full project audit: blocked flow hardening

Date: 2026-07-04
Branch: `codex/full-project-audit-blocked-flow-20260704`
Base: `master`

## Scope

Reviewed the full extension surface: MV3 manifest and permissions, service worker, blocked page flow, new tab runtime and gate overlay, options UI, layout editor, site blocking, timer/stopwatch/pomodoro, IP/weather/calendar/search/history/pinned blocks, storage/local state/sync/backup/import/export, EN/RU i18n, CI/build/typecheck configuration, performance risks from polling/fetch/MutationObserver/interval usage, security/error handling, and user settings preservation.

## Finding

The blocked page completed the unblock request and then awaited focus-stat recording before redirecting back to the originally blocked URL. If focus-stat storage failed after a successful unblock, the page could remain on the blocked screen even though the site had already been unblocked. The page also started `init()` without a top-level rejection guard, so early i18n or DOM setup failure could become an unhandled rejection.

## Fix

- Made last blocked URL lookup best-effort with a safe `https://{host}/` fallback.
- Made unblock focus-stat recording best-effort so analytics failures do not block the completed unblock redirect.
- Guarded `finishUnblock()` from the countdown tick and restored the existing failure UI when the unblock flow rejects.
- Added startup failure handling for `init()` so initialization errors are surfaced in the blocked page UI instead of becoming unhandled rejections.

## Safety

- No storage schema changes.
- No manifest permission changes.
- No feature removal.
- Existing user settings, backup format, sync format, and runtime state remain compatible.
- CI workflow has no artifacts/cache retention configuration; `retention-days: 1` is not applicable.

## Remaining risks and technical debt

- `src/newtab/instances.js` still duplicates default layout metadata from `src/lib/start-page-settings.ts` and should eventually be consolidated.
- Browser-specific native new tab and split-view behavior still depends on Chromium-derived browser internals, though failure handling is now guarded.
- External IP/weather/calendar providers can fail independently of extension code; current behavior remains best-effort.
