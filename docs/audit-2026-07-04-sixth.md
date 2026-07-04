# Sixth 10-pass audit - 2026-07-04

Repository: `lgg/start-tab-chromium`
Base branch: `master`
Working branch: `codex/sixth-10-pass-audit-20260704`

Scope for every pass:
- Architecture and responsibility boundaries
- New tab runtime
- Options UI
- Layout editor
- Site blocking
- Timers, stopwatch, and pomodoro
- IP, weather, calendar, search, history, and pinned blocks
- Storage, local state, sync, backup, import, and export
- EN/RU i18n
- Manifest permissions and MV3 behavior
- CI, build, and typecheck configuration
- Performance risks: polling spam, fetch spam, extra MutationObserver usage, extra intervals, duplicate requests
- Security, error handling, UX, and preservation of user settings

## Pass 1

Checked the full project surface listed above against the current `master`. Found that several MV3 service-worker event listeners started async work with `void` but did not attach rejection handlers. Storage/runtime failures in startup sync, native new-tab redirect checks, or blocked-navigation stats could become unhandled promise rejections in the service worker.

Fixed in `src/service-worker.ts` by attaching `.catch(ignoreBackgroundError)` to fire-and-forget listener tasks. Message handlers still return explicit acknowledgements to callers.

## Pass 2

Repeated the full-project pass with focus on storage, sync, backup, import/export, and user data preservation. Found that Chrome Sync backup upload removed old remote chunks before writing the new backup. If the new sync write failed, the previous remote backup could be partially removed.

Fixed in `src/lib/chrome-sync.ts` by writing the new meta/chunks first and removing only stale trailing chunks after the successful write. The sync payload format and checksum behavior are unchanged.

## Pass 3

Repeated the full-project pass over architecture and responsibility boundaries. Service-worker ownership of MV3 events/DNR remains separate from blocklist storage helpers, UI modules, and backup/sync helpers. The new rejection handling stays inside the service worker boundary.

No additional changes required.

## Pass 4

Repeated the full-project pass over new tab runtime, state normalization, debounced saves, cached browser/history/calendar reads, commands, and dynamic clock/date updates. No polling spam, duplicate fetch loop, or extra interval was introduced.

No additional changes required.

## Pass 5

Repeated the full-project pass over options UI, layout editor, layout presets, advanced JSON fields, and user setting preservation. Existing settings remain backward-compatible and the sync/upload change does not alter local settings schemas.

No additional changes required.

## Pass 6

Repeated the full-project pass over site blocking: host normalization, legacy migration, DNR rule sync, popup actions, blocked page countdown/unblock, and background message acknowledgements. The service-worker listener hardening reduces background failure noise without changing block/unblock semantics.

No additional changes required.

## Pass 7

Repeated the full-project pass over timers, stopwatch, pomodoro, notifications, focus stats, and stats reset. The service-worker error handling covers fire-and-forget focus-stat recording from navigation events; timer state formats are unchanged.

No additional changes required.

## Pass 8

Repeated the full-project pass over IP lookup, Google Calendar, browser history, browser pinned tabs, start-pinned links, and search providers. External reads remain explicit/cached where applicable, and this branch does not add fetch frequency or new host permissions.

No additional changes required.

## Pass 9

Repeated the full-project pass over EN/RU i18n, manifest permissions, MV3 behavior, and CI configuration. The CI workflow has no Actions artifacts/cache retention configuration, so `retention-days: 1` is not applicable.

No additional changes required.

## Pass 10

Final full-project regression pass over the same scope, focused on minimality and user data safety. The branch contains only service-worker rejection handling, safer Chrome Sync upload ordering, and this report. No feature removal, storage schema migration, permission expansion, or polling path was introduced.

No additional changes required.

## Summary of changes

- Added rejection handling for fire-and-forget MV3 service-worker listener tasks.
- Made Chrome Sync backup upload write the new backup before removing stale old chunks.
- Added this audit report documenting exactly 10 full-project audit passes.

## Remaining risks / technical debt

- `src/newtab/editor.js` still duplicates default layout block definitions that also exist in TypeScript settings code; keeping those definitions unified would reduce future drift risk.
- Some option/control helper labels still rely on fallback text if a translation key is missing.
- Broad extension permissions remain tied to the combined feature set: tabs/history/identity/storage/notifications/DNR/webNavigation and external API access.
- Weather/IP/Google API behavior still depends on external services, browser permissions, and network conditions.
