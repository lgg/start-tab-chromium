# Full Project Audit - Last Blocked URL Host Match

Date: 2026-07-04
Branch: `codex/full-project-audit-last-url-host-match-20260704`

## Scope

Reviewed the full extension surface after the previous blocklist backup/import fixes:

- Architecture and shared responsibility boundaries between service worker, new tab runtime, options UI, and shared libraries.
- New tab runtime blocks: layout editor, timers, stopwatch, pomodoro, IP, weather, calendar, search, history, browser pinned tabs, and start pinned links.
- Site blocking flow: DNR rule sync, blocked page countdown, unblock redirect, focus stats, and backup/import interaction.
- Storage and local state: settings normalization, runtime state, backup export/import, local-only blocklist state, and sync safety.
- i18n EN/RU usage for visible user-facing states.
- Manifest V3 permissions and CI workflow.
- Performance patterns: interval ownership, cached external/browser reads, avoided polling/fetch spam, and no unnecessary MutationObserver usage in the reviewed path.
- Security and error handling around restored user-controlled storage values.
- UX preservation for existing user settings and local extension state.

## Finding

`lastBlockedUrls` was normalized during backup import and storage reads, but validation only checked that each stored value was an HTTP(S) URL. A malformed or edited backup could store a normalized blocked host key such as `example.com` with a URL whose actual host was unrelated, for example `https://other.example/path` or another domain.

The normal runtime path records the correct URL because it derives the key from `blockedSiteForUrl()`. The weak point was imported or manually corrupted storage. After unblock countdown, the blocked page uses `getLastBlockedUrl(host)` to choose where to return the user, so an inconsistent stored value could cause an unexpected redirect target.

## Fix

Updated `normalizeLastBlockedUrls()` in `src/lib/blocklist.ts` to require that the stored URL host matches the normalized blocked host key using the same host/subdomain matching logic as the blocklist itself.

Accepted examples:

- key `example.com`, URL `https://example.com/path`
- key `example.com`, URL `https://sub.example.com/path`

Rejected examples:

- key `example.com`, URL `https://not-example.com/path`
- key `example.com`, non-HTTP(S) URL
- malformed host keys or URL values

This is intentionally backward compatible for valid existing state. It only drops inconsistent `lastBlockedUrls` entries; the actual `blockedSites` list and user settings remain untouched.

## Verification

- Re-reviewed the blocked navigation flow from `webNavigation.onBeforeNavigate` through `rememberBlockedNavigation()`, `getLastBlockedUrl()`, blocked page countdown, and `unblockHost()` cleanup.
- Re-reviewed backup import path in `src/lib/backup.ts`; it already routes `lastBlockedUrls` through `normalizeLastBlockedUrls()`.
- Re-reviewed `.github/workflows/ci.yml`; it has no artifact/cache usage, so no retention change is required.
- Expected CI coverage: `npm run typecheck`, `npm run build`, and `npm run build:blocker-only` from the repository CI workflow.

## Remaining Risk

The project still does not appear to have dedicated automated unit tests for storage normalization edge cases. CI typecheck/build should catch integration and typing issues, but future normalization changes would benefit from focused tests around backup import and blocklist state migration.
