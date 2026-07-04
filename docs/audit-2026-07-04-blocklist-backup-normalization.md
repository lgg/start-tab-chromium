# Audit 2026-07-04: Blocklist backup normalization

## Scope

Performed a full-project quality audit pass across the current `master` state after the previous instance layout ID normalization merge. The review covered:

- architecture and responsibility boundaries for shared libraries, options UI, new tab runtime, service worker, and runtime helper scripts;
- new tab rendering, dynamic block refresh, timers, stopwatch, pomodoro, stats, notes, local tasks, search, IP, weather, Google Calendar, history, browser pinned, and Start Tab pinned blocks;
- options UI, backup/import/export, sync flows, and layout editor persistence paths;
- site blocking, declarativeNetRequest rules, blocked navigation tracking, and unblock return URLs;
- storage normalization and preservation of user settings/local state;
- EN/RU i18n coverage for touched surfaces;
- manifest MV3 permissions and background behavior;
- CI workflow for typecheck and both build modes;
- performance risks around repeated fetches, intervals, MutationObserver usage, and storage writes;
- security and error handling around imported user-controlled backup data.

## Finding

`importBackup()` normalized `startPageSettings` before writing imported storage, but `blockedSites` was written back exactly as it appeared in the backup bundle. `syncRules()` still normalized values before generating declarativeNetRequest rules, so blocking behavior usually worked, but the raw `chrome.storage.local.blockedSites` value could remain inconsistent after import.

Impact: imported backups could persist full URLs, `www.` variants, duplicates, invalid entries, or non-string values in local storage. Options UI and future exports would then keep carrying the unclean storage shape even though runtime rules were normalized on read.

## Fix

Updated the shared blocklist and backup import path:

- exported `normalizeBlockedSites(value: unknown)` from `src/lib/blocklist.ts`;
- reused it in `readBlockedSites()`, `setBlockedSites()`, `replaceBlockedSites()`, and rule generation;
- applied it in `src/lib/backup.ts` when importing the `blockedSites` storage key;
- kept existing user-facing behavior: valid hosts are preserved, URLs are reduced to hosts, duplicates are removed, invalid entries are dropped.

## Verification

- Reviewed CI workflow: PRs run `npm ci`, `npm run typecheck`, `npm run build`, and `npm run build:blocker-only`.
- Workflow has no artifacts/cache configuration, so no `retention-days` update is required.
- GitHub Actions result is recorded on the PR before merge.

## Remaining risk / technical debt

- The Commands block on the new tab can still improve async action error presentation. It was reviewed in this pass, but not changed here to keep the storage/import fix small and avoid a large full-file replacement of `src/newtab/newtab.ts` through the connector.
- Full browser-extension interaction testing remains manual; CI covers typecheck/build only.
- Weather and Google Calendar blocks still depend on external services/OAuth setup and degrade to unavailable states when those services fail.
