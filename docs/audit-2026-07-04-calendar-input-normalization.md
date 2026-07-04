# Audit report: Calendar input normalization

Date: 2026-07-04
Branch: `codex/full-project-audit-calendar-inputs-20260704`
Base: `master`

## Scope checked

This audit pass reviewed the project areas that affect extension runtime behavior, persisted user settings, and external integrations:

- Shared architecture boundaries between settings normalization, new tab runtime, service worker, backup/sync, Google integration, blocklist, popup, and blocked page.
- New tab runtime rendering for search, links, timers, stopwatch, pomodoro, notes, local tasks, IP, weather, calendar, history, browser pinned, Start Tab pinned, commands, and stats blocks.
- Options UI flows for start page settings, layout editor data, blocklist, backup/import/export, Chrome sync, Google Drive backup, locale preference, and reset behavior.
- Layout block normalization and preservation of user-created layout state.
- Site blocking flow through Manifest V3 DNR, last blocked URL tracking, popup state, and blocked page actions.
- Timer/stopwatch/pomodoro runtime state persistence and focus stats recording.
- Storage/local state/sync/backup/import/export behavior with emphasis on not deleting user keys unexpectedly.
- i18n EN/RU catalog loading and fallback behavior.
- Manifest V3 permissions and service worker event usage.
- CI/build/typecheck workflow. The workflow does not use Actions artifacts/cache, so `retention-days: 1` is not applicable in this revision.
- Performance-sensitive paths for repeated fetches, cached remote data, intervals, polling, mutation observers, and repeated storage reads.
- Security and error handling for user-provided URLs, endpoints, calendar inputs, backup payloads, and extension pages.
- UX preservation of existing settings and local runtime state.

## Finding

`listCalendarEvents()` accepted `calendarId` and `maxResults` directly. Most calls come from normalized settings, but the shared integration function itself could still build a malformed Google Calendar request if a blank/probe-only calendar id or invalid limit reached it. A blank calendar id produces an invalid `/calendars//events` request instead of falling back to the expected `primary` calendar behavior.

## Fix

`src/lib/google-integration.ts` now normalizes calendar request inputs at the integration boundary:

- Blank or whitespace-only `calendarId` values fall back to `primary`.
- `maxResults` is rounded and clamped to the same safe `1..25` range used by settings normalization.

## User state impact

No storage keys, settings schema, backup schema, or imported data are changed. Existing valid custom calendar IDs still work after trimming. Invalid blank calendar IDs now recover to `primary` instead of failing the calendar block request.

## Remaining risks

- Google integration still depends on a real OAuth client id being configured in the manifest before calendar/Drive features can work.
- There are still no dedicated browser API unit tests for Google integration edge cases; CI covers typecheck and both extension builds.
