# Ten-pass audit report

Branch: `audit/ten-pass-roadmap-cleanup`
Base: `master` at `6d1328771bab9273a10259712223bbb0c77fa600`

## Pass 1: Project structure, build, manifest, CI
Checked package scripts, build outputs, Manifest V3 shape, permissions, and GitHub Actions. No artifact upload/cache steps are present, so there is no GitHub artifact retention issue to configure. Permissions are broad but currently map to implemented features: blocking, history/recent, pinned tabs, notifications, identity, sync/backup.

## Pass 2: Settings schema, defaults, backup, sync
Checked typed settings normalization, backup export/import, Chrome sync backup, Google integration backup hooks, runtime state coverage. Backup covers app settings, runtime state, onboarding, blocklist, last blocked URLs, locale override, and focus stats. Sync metadata/device/chunk internals are intentionally excluded.

## Pass 3: New tab network ownership
Found duplicate weather ownership: `newtab.ts` fetched weather while `instances.js` also patched per-block weather. Fixed by making `newtab.ts` render only a weather placeholder and leaving weather fetch ownership to `instances.js`.

## Pass 4: Focus stats storage behavior
Found redundant `getStartPageSettings()` read inside `recordBlockedNavigation()`: settings were read once for dedupe and again for domain minutes. Fixed by passing already-loaded settings into the domain minutes calculation.

## Pass 5: Options page observer behavior
Found `MutationObserver` calling `enhance()` on every child mutation and possible concurrent IP provider field creation during async settings read. Fixed with debounced scheduling and a per-grid enhancement lock.

## Pass 6: IP lookup behavior
Checked `newtab-ip.js`: lookup is one-shot per tab, caches result/unavailable state, queues render, and does not retry after failure on the same page. No additional fix needed in this pass.

## Pass 7: Timers, clocks, and runtime persistence
Checked primary and instance clock paths. Timer/stopwatch/pomodoro state is persisted in local storage and restored by block id. Dynamic updates are guarded so static layouts do not start unnecessary ticking.

## Pass 8: Split/native new tab escape path
Checked `newtab-gate.js`, service worker bypass, and UI escape button. The extension cannot reliably detect Comet Split View intent from standard extension APIs, so the implemented fallback is a one-shot native new tab escape button that bypasses Start Tab for the next new tab.

## Pass 9: Settings UI and layout editor
Checked settings tabs, backup grouping, Start Tab grouping, layout mode/zone, block add/duplicate/remove/configure, and full-width layout zone behavior. Existing implementation supports duplicate configurable blocks except singleton browser-derived blocks.

## Pass 10: Localization and UX consistency
Checked main localization coverage for popup, blocked page, settings, new tab, layout editor, backup groups, and diagnostics. Remaining JS fallbacks are non-critical prompt/helper labels and do not affect runtime correctness. No blocking issue found.
