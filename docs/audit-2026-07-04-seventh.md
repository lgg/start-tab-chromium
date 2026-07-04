# Seventh 10-pass audit - 2026-07-04

Repository: `lgg/start-tab-chromium`
Base branch: `master`
Working branch: `codex/seventh-10-pass-audit-20260704`

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

Checked the full project surface listed above against the current `master`. Found that `loadI18n()` loaded the detected or overridden locale catalog directly. If a non-default catalog failed to load or parse, options/newtab/blocked UI could fail instead of falling back to the default English catalog.

Fixed in `src/lib/i18n.ts` by merging non-default catalogs through a guarded helper and falling back to the default catalog and document language on failure. This does not change the stored locale preference.

## Pass 2

Repeated the full-project pass with focus on new tab onboarding, layout presets, runtime startup, and optional first-run flows. Found that onboarding async handlers and the initial async startup were launched without rejection handling. Storage failures could become unhandled promise rejections even though onboarding is optional.

Fixed in `src/newtab/onboarding.ts` by adding guarded `.catch()` handling for preset apply, skip, and initial onboarding startup.

## Pass 3

Repeated the full-project pass over architecture and separation of responsibilities. The i18n fallback stays inside the locale helper, and onboarding failure handling stays inside the optional onboarding module. No cross-module behavior or storage schema was changed.

No additional changes required.

## Pass 4

Repeated the full-project pass over new tab runtime, dynamic blocks, timers, notes, tasks, history, pinned tabs, commands, and stats. The changes do not add polling, intervals, fetches, or repeated browser API reads.

No additional changes required.

## Pass 5

Repeated the full-project pass over options UI, background presets, layout editor, layout presets, and advanced JSON controls. Existing user settings remain compatible; language fallback does not overwrite locale preference or layout state.

No additional changes required.

## Pass 6

Repeated the full-project pass over site blocking: host normalization, legacy migration, DNR rules, popup actions, blocked page countdown/unblock, and service-worker message acknowledgements. Existing blocking semantics are unchanged.

No additional changes required.

## Pass 7

Repeated the full-project pass over timers, stopwatch, pomodoro, notifications, focus stats, and state persistence. Onboarding and i18n changes do not alter timer/focus state formats or behavior.

No additional changes required.

## Pass 8

Repeated the full-project pass over IP lookup, Google Calendar, weather, search, history, browser pinned tabs, and start-pinned blocks. External reads remain explicit/cached where applicable, and this branch does not add fetch spam or permissions.

No additional changes required.

## Pass 9

Repeated the full-project pass over storage/local state/sync/backup/import/export, EN/RU i18n, manifest permissions, MV3 behavior, and CI configuration. Previous backup/sync safety fixes remain in place. The CI workflow has no Actions artifacts/cache retention configuration, so `retention-days: 1` is not applicable.

No additional changes required.

## Pass 10

Final full-project regression pass over the same scope, focused on minimality and user settings preservation. The branch contains only i18n fallback hardening, onboarding async failure handling, and this report. No feature removal, storage migration, permission expansion, or background polling was introduced.

No additional changes required.

## Summary of changes

- Added default-locale fallback when a non-default i18n catalog fails to load.
- Added guarded async failure handling to optional onboarding startup and actions.
- Added this audit report documenting exactly 10 full-project audit passes.

## Remaining risks / technical debt

- `src/newtab/editor.js` and `src/newtab/instances.js` still duplicate default layout block definitions from TypeScript settings code; unifying those definitions would reduce future drift risk.
- Some JS helper UI strings still rely on fallback text instead of the typed i18n helper.
- Broad extension permissions remain tied to the combined feature set: tabs/history/identity/storage/notifications/DNR/webNavigation and external API access.
- Weather/IP/Google API behavior still depends on external services, browser permissions, and network conditions.
