# Fourth 10-pass audit - 2026-07-04

Repository: `lgg/start-tab-chromium`
Base branch: `master`
Working branch: `codex/fourth-10-pass-audit-20260704`

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

Checked the full project surface listed above against the current `master` after the previous merged audit iteration. Found that the blocked-site page assumed the MV3 background service worker would always answer the `unblock` message. If the worker restarted while the page was open, `sendMessage` could reject and leave the page stuck in the countdown completion state.

Fixed in `src/blocked/blocked.ts` by wrapping the unblock message in `requestUnblock()`, treating transport failure as a normal unblock failure, restoring the UI, and keeping the existing localized failure message. User settings and blocklist state are not changed on failure.

## Pass 2

Rechecked architecture and separation of responsibility across runtime UI, service worker message handling, blocklist/DNR helpers, storage helpers, and UI modules. The new blocked-page helper keeps UI error recovery inside the page and leaves DNR mutation ownership in the service worker/blocklist layer.

No additional changes required.

## Pass 3

Rechecked the new tab runtime, cached data flows, widget rendering, layout hydration, theme handling, and debounced persistence. The runtime continues to use scoped cache/debounce behavior rather than repeated polling, and no user-facing settings schema changed.

No additional changes required.

## Pass 4

Rechecked options UI and layout editor behavior, including active-tab persistence, block visibility, widget ordering, custom background settings, and editor save paths. Existing options state remains backward-compatible and the blocked-page change does not interact with options storage.

No additional changes required.

## Pass 5

Rechecked site blocking end to end: host normalization, legacy storage migration, DNR rule syncing, popup actions, blocked page countdown/cancel/pagehide behavior, and service-worker acknowledgement paths. The only issue in this pass family was the blocked-page transport failure fixed in pass 1.

No additional changes required after the pass 1 fix.

## Pass 6

Rechecked timers, stopwatch, pomodoro, focus stats, notification paths, and interval lifecycle. Existing timers are scoped to visible runtime behavior and no extra interval or polling path was introduced by the fix.

No additional changes required.

## Pass 7

Rechecked IP, weather, calendar, search, history, and pinned blocks. The code keeps external fetches and browser API reads behind explicit/cached flows where applicable, and the change does not increase fetch frequency or duplicate requests.

No additional changes required.

## Pass 8

Rechecked storage, local state, sync chunking, sync metadata validation, backup, import, export, and DNR resync after import. Previous sync metadata bounds are still present, known backup keys remain constrained, and this iteration does not alter serialized user data.

No additional changes required.

## Pass 9

Rechecked EN/RU i18n coverage, manifest permissions, MV3 service-worker behavior, and CI workflow configuration. The blocked-page fix reuses the existing `failedToUnblock` translation. The CI workflow does not define Actions artifacts/cache retention, so the requested `retention-days: 1` check is not applicable for this iteration.

No additional changes required.

## Pass 10

Final full-project regression pass over the same scope, with focus on UX preservation and minimality of the patch. The branch contains only the blocked-page error-handling hardening and this report. No feature removal, storage reset, permission expansion, or background polling was introduced.

No additional changes required.

## Summary of changes

- Hardened blocked-page unblock completion against rejected MV3 `runtime.sendMessage` calls.
- Restored the blocked-page UI on unblock transport failure instead of leaving the page in an in-progress state.
- Added this audit report documenting exactly 10 full-project audit passes.

## Remaining risks / technical debt

- Some option/control helper labels still rely on fallback text if a translation key is missing.
- Broad extension permissions remain tied to the combined feature set: history, top sites, storage, alarms, notifications, DNR, geolocation, and external API access.
- Weather/IP availability still depends on external services and browser/network behavior.
