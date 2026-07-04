# Start Tab Chromium Audit Report - 2026-07-04 Third Pass Set

Branch: `codex/third-10-pass-audit-20260704`
Base: current `master` after PR #34
Scope: 10 full-project audit passes across architecture, new tab runtime, options UI, layout editor, site blocking, timers, IP/weather/calendar/search/history/pinned blocks, storage/local state/sync/backup/import/export, EN/RU i18n, manifest/MV3 permissions, CI/build/typecheck, performance, security/error handling, UX, and preservation of user settings.

## Pass 1
Checked the whole project from manifest and build wiring through service worker, popup, blocked page, new tab, options, storage, backup/sync, i18n, and CI. Found that Chrome sync backup uploads were capped, but restored sync metadata accepted any positive `chunks` count. Fixed `src/lib/chrome-sync.ts` so sync metadata is only trusted when `chunks <= MAX_SYNC_CHUNKS`.

## Pass 2
Rechecked architecture and separation of responsibility after the sync-meta fix. Service worker still owns DNR mutations, blocklist logic owns normalization/rule building, popup and blocked page remain UI callers, and start-page settings remain centralized. No additional code change was needed.

## Pass 3
Rechecked new tab runtime: settings load, runtime-state normalization, notes/tasks/link-page persistence, commands, stats, and dynamic date/clock refresh. State writes are debounced or event-driven, and the dynamic interval is only created when dynamic blocks are enabled. No additional code change was needed.

## Pass 4
Rechecked options UI and layout editor. The main options form preserves active tab state, layout editor writes only layout fields, helper fields preserve pending layout/IP values around core saves, and background presets preserve existing appearance/preset data. No additional code change was needed.

## Pass 5
Rechecked site blocking flow. Host parsing rejects unsupported schemes, legacy storage migration is guarded by a shared promise, DNR rules are rebuilt from normalized storage, blocked page countdown has the previous active-state guard, and popup actions have the previous MV3 message error guard. No additional code change was needed.

## Pass 6
Rechecked timers, stopwatch, pomodoro, focus stats, and notifications. Clock state is normalized on load, focus stats are normalized by schema version, and stats writes remain scoped to `focusStats`. No additional code change was needed.

## Pass 7
Rechecked IP, weather, Google Calendar, search, recent history, browser pinned tabs, and Start Tab pinned links. IP lookup is one-shot per page lifetime with provider fallback, calendar/history/pinned reads are cached, and compact URL rendering filters to http/https. No additional code change was needed.

## Pass 8
Rechecked storage/local state/sync/backup/import/export. Backup export/import only uses known extension storage keys, import validates bundle shape and resyncs DNR, Google Drive backup restores through the same import path, and Chrome sync now bounds both upload and trusted restore metadata. No additional code change was needed.

## Pass 9
Rechecked EN/RU i18n, manifest permissions, and MV3. Core typed UI messages are present in both locales, helper overlays use `chrome.i18n` with fallbacks, and permissions still match active features: DNR/webNavigation for blocking, tabs/history for pinned/recent blocks, identity for Google, notifications for timers, storage/unlimitedStorage for settings/backups/background images. CI has no artifacts/cache, so `retention-days: 1` is not applicable. No additional code change was needed.

## Pass 10
Final regression-oriented pass across build/typecheck assumptions, performance, security/error handling, and UX preservation. Verified the branch changes are limited to the sync metadata guard and this report, with no storage schema churn and no feature removal. Remaining larger tradeoffs are documented below.

## Fixed
- `src/lib/chrome-sync.ts`: `isSyncMeta()` now rejects remote/local sync metadata with a `chunks` count above `MAX_SYNC_CHUNKS`.
- This prevents malformed sync metadata from causing excessive chunk-key reads and keeps restore behavior aligned with the upload size guard.

## Remaining Risks / Technical Debt
- Some plain JavaScript helper overlays still use fallback English labels next to `chrome.i18n` lookups; this is safe at runtime but less complete than the typed EN/RU UI.
- Manifest permissions are intentionally broad because the extension combines blocking, history, pinned tabs, Google integrations, notifications, backups, and newtab override.
- Public IP and weather providers may rate-limit or fail; current behavior is graceful fallback/error text rather than guaranteed availability.
