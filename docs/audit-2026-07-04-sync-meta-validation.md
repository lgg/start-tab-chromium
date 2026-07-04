# Audit report: Chrome sync metadata validation

Date: 2026-07-04
Branch: `codex/full-project-audit-sync-meta-validation-20260704`
Base: `master`

## Scope checked

This audit pass reviewed the project areas that can affect runtime correctness, persisted user state, and extension safety:

- Architecture and responsibility split between shared libraries, service worker, new tab runtime, options UI, popup, and blocked page.
- New tab runtime rendering, clock state, cached dynamic blocks, search/history/pinned/calendar/weather/IP blocks, and state persistence boundaries.
- Options UI handling for layout, links, search providers, backup/import/export, sync, Drive backup, locale preference, and blocklist controls.
- Layout editor normalization and preservation of user-configured block settings.
- Site blocking flow, DNR rules, last blocked URL tracking, popup integration, and blocked page unblock behavior.
- Timer, stopwatch, pomodoro, and focus stats state handling.
- Storage/local state/sync/backup/import/export behavior with emphasis on preserving keys that are absent from imported backups.
- i18n EN/RU loading and fallback behavior.
- Manifest V3 permissions, service worker listeners, and extension page exposure.
- CI/build/typecheck configuration. The workflow does not use Actions artifacts/cache, so `retention-days: 1` is not applicable in this revision.
- Performance-sensitive areas: repeated fetches, runtime caches, intervals, polling, mutation observers, and repeated storage reads.
- Security and error handling for user-provided URLs, endpoints, backup payloads, sync metadata, and direct web-accessible extension pages.
- UX preservation of existing settings and local runtime state.

## Finding

`src/lib/chrome-sync.ts` accepted remote and local sync metadata when the fields merely had the expected primitive types. Invalid timestamps, empty device IDs, or malformed checksums could be treated as valid metadata. That made the sync direction decision depend on `Date.parse()` fallback behavior and could produce confusing restore/upload behavior when `chrome.storage.sync` contained corrupted or manually edited metadata.

## Fix

`isSyncMeta()` now accepts metadata only when:

- `updatedAt` parses as a valid timestamp.
- `deviceId` is a non-empty string.
- `checksum` is a lowercase 64-character SHA-256 hex digest.
- `chunks` remains an integer in the existing `1..MAX_SYNC_CHUNKS` range.

Malformed sync metadata is treated as absent, so the existing upload/restore paths can recover without importing an invalid sync bundle.

## User state impact

The change does not rename, remove, or migrate storage keys. Existing valid sync backups produced by the extension continue to pass validation because the extension already writes ISO timestamps and lowercase SHA-256 checksums. Corrupted sync metadata is ignored instead of being trusted.

## Remaining risks

- There are no automated unit tests for Chrome extension storage edge cases; coverage still relies on typecheck/build CI and manual reasoning for browser APIs.
- The manifest still requires broad permissions for the current feature set. Further reduction would require feature-level redesign, not a safe audit hotfix.
