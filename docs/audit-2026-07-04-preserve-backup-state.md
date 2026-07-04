# Full project audit: preserve backup import state

Date: 2026-07-04
Branch: `codex/full-project-audit-preserve-backup-state-20260704`

## Scope checked

This pass reviewed the current `master` after the previous endpoint and blocklist fixes. The pass covered:

- extension architecture and responsibility split between service worker, shared libraries, new tab runtime, popup, options UI, and static scripts;
- new tab runtime rendering, dynamic clock updates, cached calendar/history/pinned data, IP lookup fallback behavior, and settings application;
- options UI save flow, layout editor, JSON editors, backup controls, sync controls, and Google Drive restore path;
- site blocking flow, MV3 declarativeNetRequest rules, last blocked URL handling, popup host status, and focus statistics;
- timer, stopwatch, pomodoro, notification, and focus-stat persistence behavior;
- search/history/pinned/custom links safety and previously added URL normalization;
- storage/local state/sync/backup/import/export behavior;
- EN/RU i18n usage around affected UI paths;
- manifest permissions, MV3 service worker, and CI workflow;
- performance risks around polling, fetch retries, MutationObserver, intervals, and repeated requests;
- security/error handling and preservation of user settings.

## Finding

`importBackup()` restored keys that were present in the backup file, then removed every managed storage key that was missing from that file.

That was risky for partial or older backup files and for external restore sources such as chrome sync or Google Drive. A backup that omitted runtime state, onboarding state, locale override, focus stats, or other managed keys could erase those local values even though the user did not explicitly reset them.

This conflicted with the project requirement to avoid breaking user settings and local extension state during restore.

## Fix

Changed `src/lib/backup.ts` so backup import only updates the storage keys present in the validated backup payload. Missing keys are now left untouched.

The existing normalization remains in place for sensitive structured values:

- `blockedSites` is normalized before restore;
- `lastBlockedUrls` is normalized and host-matched before restore;
- `startPageSettings` is normalized before restore;
- DNR rules are still resynced after import.

## Verification

- Reviewed options import, chrome sync restore, Google Drive restore, blocklist sync, settings normalization, and new tab runtime consumers.
- Confirmed CI workflow still runs typecheck and both extension builds.
- `.github/workflows/ci.yml` does not upload artifacts or configure caches, so `retention-days: 1` is not applicable.

## Remaining risk

There is no dedicated automated test suite for backup import merge semantics. CI currently verifies TypeScript typecheck and production builds.
