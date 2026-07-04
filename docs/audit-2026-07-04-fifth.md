# Fifth 10-pass audit - 2026-07-04

Repository: `lgg/start-tab-chromium`
Base branch: `master`
Working branch: `codex/fifth-10-pass-audit-20260704`

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

Checked the full project surface listed above against the current `master`. Found that `importBackup()` removed all known local storage keys before writing imported data. If `chrome.storage.local.set()` failed after removal, existing user settings/local state could be lost.

Fixed in `src/lib/backup.ts` by writing imported keys first, then removing known keys absent from the backup. This preserves existing data if the write fails before replacement completes.

## Pass 2

Repeated the full-project pass with focus on settings normalization, options UI, layout editor, and user settings preservation. Found that old saved `layout.blocks` arrays could omit newer default block definitions forever, making new block types unavailable unless the user reset all settings.

Fixed in `src/lib/start-page-settings.ts` by appending missing default layout blocks as disabled blocks during normalization. The current visible layout is preserved, while newer blocks remain available for settings/editor flows.

## Pass 3

Repeated the full-project pass over the new tab runtime, timers, notes, local tasks, history, pinned tabs, commands, stats, and backup commands. Verified that the changes do not add polling, intervals, repeated browser API queries, or extra external fetches.

No additional changes required.

## Pass 4

Repeated the full-project pass over options UI and layout editing controls. Verified tabbed settings grouping, layout preset handling, JSON-backed advanced controls, drag/drop editor behavior, and save paths. The new layout-block normalization is backward-compatible and does not force-enable new blocks.

No additional changes required.

## Pass 5

Repeated the full-project pass over site blocking: host normalization, legacy storage migration, DNR dynamic rule syncing, blocked page countdown, popup actions, service worker messages, and unblock/error handling. Previous message-failure hardening remains intact.

No additional changes required.

## Pass 6

Repeated the full-project pass over timers, stopwatch, pomodoro, notifications, focus stats, and storage state. The import-order fix improves failure safety for these persisted states and does not change their schema.

No additional changes required.

## Pass 7

Repeated the full-project pass over IP lookup, Google Calendar, browser history, browser pinned tabs, start-pinned links, and search providers. Fetches remain explicit/cached, and no fetch spam or repeated request loop was introduced.

No additional changes required.

## Pass 8

Repeated the full-project pass over storage/local state/sync/backup/import/export. Confirmed known backup keys remain bounded, unsupported backup shapes are rejected, Chrome sync metadata bounds from earlier audits remain in place, and DNR rules are resynced after import.

No additional changes required after the pass 1 import-order fix.

## Pass 9

Repeated the full-project pass over EN/RU i18n, manifest permissions, MV3 service worker behavior, and CI configuration. The workflow does not define Actions artifacts/cache retention, so `retention-days: 1` is not applicable.

No additional changes required.

## Pass 10

Final full-project regression pass over the same scope, with focus on minimality and user-state preservation. The branch contains only backup import hardening, layout settings normalization, and this report. No feature removal, permission expansion, storage reset, or background polling was introduced.

No additional changes required.

## Summary of changes

- Made backup import safer by writing imported storage before removing omitted known keys.
- Preserved access to newly added layout blocks for users with older saved layout settings by appending missing defaults as disabled blocks.
- Added this audit report documenting exactly 10 full-project audit passes.

## Remaining risks / technical debt

- Some option/control helper labels still rely on fallback text if a translation key is missing.
- Broad extension permissions remain tied to the combined feature set: history, top sites/tabs, storage, notifications, DNR, identity, geolocation-adjacent external APIs, and external fetch access.
- Weather/IP/Google API behavior still depends on external services, browser permissions, and network conditions.
