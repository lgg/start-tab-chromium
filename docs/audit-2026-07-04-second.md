# Start Tab Chromium Audit Report - 2026-07-04 Second Pass Set

Branch: `codex/second-10-pass-audit-20260704`
Base: current `master` after PR #33
Scope: 10 full-project audit passes across architecture, new tab runtime, options UI, layout editor, site blocking, timers, IP/weather/calendar/search/history/pinned blocks, storage/local state/sync/backup/import/export, EN/RU i18n, manifest/MV3 permissions, CI/build/typecheck, performance, security/error handling, UX, and preservation of user settings.

## Pass 1
Checked the full extension surface from manifest and service worker through popup, blocked page, new tab, options, storage, backup/sync, i18n, and CI. Found popup actions assumed `chrome.runtime.sendMessage` always resolved and returned an ack; a transient MV3 service worker restart or runtime error could leave block/unblock/clear without useful feedback. Fixed `src/popup/popup.ts` with a safe action helper, clear-button disabling while pending, and restored button state on failure.

## Pass 2
Rechecked architecture and responsibility boundaries after the popup fix. Service worker remains the single owner of DNR mutations, popup and blocked page stay thin, start-page settings remain centralized, and backup/import still refreshes DNR after restoring blocklist data. No additional code change was needed.

## Pass 3
Rechecked the new tab runtime, including date/time, search, links, commands, stats, recent history, browser pinned tabs, start pinned links, Google Calendar, weather placeholder flow, and IP helper. Existing caching/debounce behavior prevents repeated history/tab/calendar reads and IP lookup spam. No additional code change was needed.

## Pass 4
Rechecked options UI and layout editor behavior. The main options renderer preserves active tab state, layout editor writes only the layout slice it owns, extra helper controls preserve pending layout/IP values around core form saves, and background presets preserve existing appearance fields and user presets. No additional code change was needed.

## Pass 5
Rechecked site blocking and blocked-page UX. Host normalization rejects unsupported schemes and malformed values, legacy storage migration is guarded by a shared promise, DNR rules are regenerated from normalized storage, and the countdown fix from the previous audit remains present. No additional code change was needed.

## Pass 6
Rechecked timers, stopwatch, pomodoro, focus stats, notifications, and runtime state persistence. The main newtab timer loop is created only when dynamic blocks are enabled; instance clocks use a single guarded loop path; pagehide saves runtime state. No additional code change was needed.

## Pass 7
Rechecked IP, weather, Google Calendar, search, history, browser pinned, and Start Tab pinned blocks. External fetches are user-visible, caught on failure, and either cached or one-shot for the page lifetime; URL rendering accepts only http/https links for compact list anchors. No additional code change was needed.

## Pass 8
Rechecked storage/local state/sync/backup/import/export. Backup export is limited to known extension keys, import validates the bundle and only restores recognized keys, Chrome sync chunks are capped by the previous audit fix, and DNR sync is invoked after import. No additional code change was needed.

## Pass 9
Rechecked EN/RU i18n, manifest permissions, and MV3 constraints. Core typed UI strings are localized in EN/RU, helper scripts use `chrome.i18n` with local fallback strings, and manifest permissions match current features: tabs/history for pinned and recent blocks, identity for Google integrations, storage/unlimitedStorage for local state and image presets, DNR/webNavigation for blocking and stats. CI uses no artifacts/cache, so `retention-days: 1` does not apply. No additional code change was needed.

## Pass 10
Final full regression-oriented pass across build/typecheck assumptions, performance, security/error handling, and user settings preservation. Verified the branch contains only the popup hardening plus this report, avoiding feature removal and avoiding storage schema churn. Remaining technical debt is documented below rather than changed because fixing it would be broader than a minimal pragmatic audit patch.

## Fixed
- `src/popup/popup.ts`: centralized popup service-worker message handling in `sendAction()` so block, unblock, and clear handle rejected messages and negative acknowledgements consistently.
- `src/popup/popup.ts`: prevents repeated clear clicks while a clear request is pending.
- `src/popup/popup.ts`: restores the primary action button when block/unblock fails instead of leaving the popup in a disabled state.

## Remaining Risks / Technical Debt
- Some plain JavaScript helper overlays still keep fallback English strings next to `chrome.i18n` lookups. This keeps runtime safe but leaves helper-only labels less complete than the typed options/newtab i18n surface.
- Manifest permissions are broad because the extension combines blocking, history, pinned tabs, Google integrations, backups, notifications, and newtab override in one package. Splitting optional capabilities would require a larger product/design pass.
- External public IP and weather providers can rate-limit or fail; the current behavior is graceful fallback/error text, not guaranteed availability.
