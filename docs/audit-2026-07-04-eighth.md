# Audit report: eighth 10-pass iteration

Date: 2026-07-04
Branch: `codex/eighth-10-pass-audit-20260704`
Base: `master`

Scope for every pass: architecture and responsibility boundaries; new tab runtime; options UI; layout editor; site blocking; timer, stopwatch, and pomodoro; IP, weather, calendar, search, history, and pinned blocks; storage, local state, sync, backup, import, and export; EN/RU i18n; manifest permissions and MV3 behavior; CI, build, and typecheck; performance risks from polling, fetch loops, MutationObserver, intervals, and repeated requests; security and error handling; UX and user setting preservation.

## Pass 1

Reviewed the full project flow from MV3 service worker to the new tab gate, settings storage, options, blocked page, sync, and backup surfaces. Found that `src/newtab/newtab-gate.js` started several asynchronous browser API actions without guarded rejection handling: native-new-tab button, reusable action buttons, split-view tab selection, diagnostic storage writes, and the initial `applyGate()` call. Fixed this by adding a shared guarded gate-action runner, making split-view diagnostics non-blocking, catching failed tab updates from tab-picker buttons, and guarding the top-level gate startup.

## Pass 2

Rechecked the full runtime after the pass 1 fix. Architecture remained separated: service worker owns DNR/blocking, options owns persisted settings edits, static new tab scripts own rendered runtime helpers. No additional storage schema changes were needed. Verified the pass 1 fix does not change persisted setting shapes or local runtime state.

## Pass 3

Reviewed options UI, backup/import/export, Chrome Sync, Drive backup hooks, blocklist controls, and layout editor. Existing handlers already preserve JSON parsing errors and user-visible status for backup/sync/Drive flows. No extra fix was applied in this pass because the remaining generic options `actionButton` behavior is broader UI hardening rather than a confirmed regression in this iteration.

## Pass 4

Reviewed layout editor, preset application, normalized settings, and preservation of user layouts. Confirmed default missing layout blocks are appended disabled by normalization, so existing custom layouts are not silently reset. No code change required.

## Pass 5

Reviewed blocking runtime, blocked page countdown, service-worker message handling, and focus stats recording. Confirmed service worker listener tasks are guarded and blocked page unblock requests tolerate restarted MV3 workers. No code change required.

## Pass 6

Reviewed timer, stopwatch, pomodoro, local tasks, note, search, history, browser pinned, Start Tab pinned, and command block behavior through the new tab instance runtime. Confirmed clock-like blocks are grouped as clock types and runtime state remains in `startTabInstanceState`; no schema migration was required. No code change required.

## Pass 7

Reviewed IP, weather, and calendar-related fetch behavior. IP lookup uses one cached lookup promise and renders cached results to repeated targets, avoiding fetch spam. Weather/calendar settings remain user-controlled through options. No code change required.

## Pass 8

Reviewed storage, local state, backup, import/export, Chrome Sync chunking, and backup restore ordering. Confirmed backup import writes imported keys before removing omitted managed keys, and Chrome Sync writes new meta/chunks before stale chunk cleanup. No code change required.

## Pass 9

Reviewed EN/RU i18n paths, fallback catalog behavior, and gate fallback messages. Confirmed catalog fallback can keep UI usable if a non-default locale fails. The gate script also keeps local fallback strings for early overlay text. No code change required.

## Pass 10

Reviewed manifest permissions, MV3 behavior, CI workflow, build/typecheck scripts, and performance guardrails. The CI workflow has no artifacts or caches, so no `retention-days` update is applicable. No additional polling, intervals, MutationObservers, or repeated fetches were introduced by this iteration. No code change required.

## Fixed

- Hardened `src/newtab/newtab-gate.js` against rejected browser API calls from gate UI actions.
- Made split-view diagnostic writes best-effort so storage failures do not block split-view overlay rendering.
- Guarded native-new-tab and split-view tab-selection actions so failed Chromium-specific tab updates do not create unhandled promise rejections.
- Guarded initial gate startup with `.catch()`.

## Remaining risks and technical debt

- `src/newtab/instances.js` still duplicates default layout metadata also defined in `src/lib/start-page-settings.ts`; future block additions must keep both in sync.
- Some options UI diagnostic/action buttons could be made consistently pending/error-aware, but existing backup/sync/Drive operations already surface errors and this iteration avoided a broad UI refactor.
- Browser-specific native new tab and split-view behavior depends on Chromium-derived browser internals; the gate now fails safely, but manual browser matrix testing remains useful.
