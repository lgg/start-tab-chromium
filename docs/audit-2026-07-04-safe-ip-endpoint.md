# Full Project Audit - Safe IP Lookup Endpoint

Date: 2026-07-04
Branch: `codex/full-project-audit-safe-endpoints-20260704`

## Scope

Reviewed the project after the custom link/search provider hardening pass:

- Architecture boundaries between service worker, popup, blocked page, new tab runtime, options UI, and shared libraries.
- Manifest V3 permissions, DNR sync ownership, `chrome_url_overrides`, OAuth placeholder behavior, host permissions, and web accessible resources.
- New tab runtime: IP lookup, search, links, start pinned links, recent history, browser pinned tabs, Google Calendar, stats, timers, stopwatch, pomodoro, local notes/tasks, and layout rendering.
- Options UI: JSON-backed settings, IP endpoint field, layout editor, backup controls, blocklist controls, locale switching, and reset behavior.
- Storage/local state/sync/backup/import/export paths: `startPageSettings`, runtime state, `blockedSites`, `lastBlockedUrls`, focus stats, chrome.storage.sync backup, and Google Drive backup.
- i18n EN/RU usage for existing user-facing states.
- CI workflow and artifact/cache retention requirements.
- Performance risks: repeated fetches, interval ownership, MutationObserver usage, browser API reads, and cached async calls.
- Security/error handling around user-controlled external endpoints and restored backup data.
- UX preservation for existing local settings and user state.

## Finding

The previous pass centralized normalization for user-controlled navigation URLs, but the IP lookup block still read `settings.ip.endpoint` directly from `chrome.storage.local` in `src/newtab/ip.js`.

The endpoint can come from:

- options UI;
- JSON backup import;
- chrome.storage.sync restore;
- Google Drive restore;
- manually edited local storage.

The runtime then placed any non-empty string into the custom provider list and called `fetch()` with it. Invalid schemes usually fail, but preserving and attempting to fetch arbitrary schemes from extension settings is inconsistent with the new safe-link policy and produces avoidable error work before fallback providers are tried.

## Fix

Updated `src/newtab/ip.js`:

- Added `safeEndpoint()`.
- Custom IP endpoint is accepted only when it is an absolute `http:` or `https:` URL.
- Invalid, empty, or malformed endpoints fall back immediately to the first built-in provider.
- Built-in provider fallback behavior is preserved.

This does not change storage schema or delete the user's setting. It only prevents unsafe or malformed endpoint values from being used at runtime.

## Verification

Expected CI coverage:

- `npm run typecheck`
- `npm run build`
- `npm run build:blocker-only`

Manual reasoning coverage:

- Existing built-in IP providers are all HTTP(S) and remain valid.
- Existing valid custom HTTP(S) endpoint values continue to work.
- Invalid schemes such as `javascript:`, `data:`, `file:`, `chrome:`, or malformed URLs are skipped before `fetch()`.
- The IP block still performs a single lookup and reuses cached results; no polling or fetch spam was introduced.
- `.github/workflows/ci.yml` has no artifact/cache usage, so `retention-days: 1` is not applicable.

## Remaining Risk

Weather endpoint fields are still stored as configurable settings, but the current reviewed new tab weather path only renders a placeholder and does not issue weather fetches in the TypeScript runtime. If live weather fetching is added later, those endpoints should use the same HTTP(S)-only runtime guard or central settings normalization.
