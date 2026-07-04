# Full project audit: new tab core async hardening

Date: 2026-07-04
Branch: `codex/full-project-audit-newtab-core-hardening-20260704`
Base: `master` at `5784f3b49028fdc8302cbe19c51e94158239a470`

## Scope

Reviewed the current project end to end: architecture and responsibility boundaries, Manifest V3 service worker and DNR flow, popup, blocked page, new tab runtime, options UI, layout editor, site blocking, timers/stopwatch/pomodoro, IP/weather/calendar/search/history/pinned blocks, storage/local state/sync/backup/import/export, EN/RU i18n, manifest permissions, CI/build/typecheck, performance-sensitive polling/fetch/observer/interval paths, security/error handling, UX, and preservation of user settings.

## Latest 30 changes reviewed

Reviewed the latest merged PR series visible in the repository history, PR #33 through PR #62. The changes were checked for storage compatibility, MV3 permission drift, runtime regressions, excessive polling/fetching, unhandled promise risks, i18n coverage, and user-state preservation.

- PR #33: ten-pass audit hardening for blocked countdown, IP observer scope, live-region noise, and Chrome sync size guard. Correctly scoped; no storage schema break found.
- PR #34: popup service-worker message hardening. Correct direction; later PRs refined error display and reload behavior.
- PR #35: Chrome sync chunk-count guard. Correctly aligns restore trust boundary with upload limit.
- PR #36: blocked-page rejected unblock handling. Correctly restores UI instead of leaving the page stuck.
- PR #37: backup import ordering and disabled missing layout blocks. Correctly preserves valid existing layout state.
- PR #38: worker listener rejection handling and sync upload ordering. Correctly prevents stale chunks from being removed before replacement data is written.
- PR #39: i18n fallback and onboarding async handling. Correctly avoids overwriting locale preference on fallback.
- PR #40: newtab gate async action hardening. Correctly keeps native-new-tab helpers best-effort.
- PR #41: options async action hardening. Correctly surfaces errors in the status area without schema churn.
- PR #42: blocked flow secondary stats failure isolation. Correctly keeps successful unblock redirect independent from stats recording.
- PR #43: layout block id normalization. Correctly repairs duplicate/empty ids while preserving valid ids.
- PR #44: normalized settings writes. Correctly routes persisted settings through central normalization.
- PR #45: backup `startPageSettings` normalization. Correctly normalizes imported settings before storage writes.
- PR #46-#50: instance refresh/import/blocked URL normalization passes. Reviewed at summary level from PR metadata and current source; no contradictory state or permission drift found.
- PR #51: last blocked URL host-match validation. Correctly drops inconsistent/corrupt redirect entries.
- PR #52: popup subdomain block status alignment. Correctly uses shared blocked-site matching.
- PR #53: custom links/search URL hardening. Correctly limits user URLs/templates to HTTP(S) paths.
- PR #54: custom IP endpoint validation. Correctly rejects non-HTTP(S) endpoints.
- PR #55: partial backup import preservation. Correctly preserves omitted local state keys.
- PR #56: compact URL rendering parser validation. Correctly avoids case-sensitive prefix checks.
- PR #57: blocked-page host parameter validation. Correctly disables direct invalid unblock flow.
- PR #58: Chrome sync metadata validation. Correctly rejects malformed metadata before direction decisions.
- PR #59: Google Calendar input normalization. Correctly trims calendar IDs and clamps result count.
- PR #60: search template multi-placeholder handling. Correctly replaces every `{query}` placeholder.
- PR #61: popup startup/actions hardening. Correctly handles rejected popup flows and best-effort reloads.
- PR #62: newtab instance runtime action hardening. Correctly guards progressive overlay actions and intervals.

## Finding

The core new tab runtime still had several fire-and-forget async paths without rejection handling. Startup used an unguarded async IIFE; block renderers launched async calendar/history/pinned/stats work with `void`; command buttons invoked async handlers without catch handling; clock/focus-stat/notification side effects were launched without a guard; and runtime-state saves could reject without being caught.

In MV3 this can surface as unhandled promise rejections if storage, notifications, history, tabs, Google integration, or extension page APIs fail transiently. The issue is most visible on the new tab page because it is the primary long-lived UI and combines timers, stats, history, pinned tabs, backups, and settings actions.

## Fix

- Added a shared `runRuntimeAction()` helper to `src/newtab/newtab.ts`.
- Guarded new tab startup failure handling.
- Guarded runtime-state saves.
- Guarded async renderers for Google Calendar, recent history, browser pinned tabs, and stats.
- Guarded focus-stat side effects from Pomodoro start/interruption/completion flows.
- Guarded notification and stats refresh side effects after clock completion.
- Guarded new tab command buttons and options-page opening actions.

## Safety

- No storage keys were added, removed, renamed, or migrated.
- No backup, sync, or import/export schema changed.
- No manifest permissions changed.
- No features were removed.
- Existing user settings, layout state, runtime state, backups, and sync payloads remain compatible.
- CI workflow has no Actions artifacts/cache configuration; `retention-days: 1` is not applicable.

## Remaining risks and technical debt

- `src/newtab/instances.js` still duplicates layout metadata from `src/lib/start-page-settings.ts`; consolidating that should be a dedicated typed-module cleanup.
- External IP, weather, Google Calendar, browser history, pinned-tab, notification, and storage APIs remain best-effort by nature and can fail due to permissions, browser policy, OAuth configuration, rate limits, or service availability.
- Some plain JavaScript helper layers still contain fallback English strings next to `chrome.i18n` lookups; this is runtime-safe but less complete than the typed EN/RU UI surface.
