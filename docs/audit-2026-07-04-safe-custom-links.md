# Full Project Audit - Safe Custom Links And Search Templates

Date: 2026-07-04
Branch: `codex/full-project-audit-safe-links-20260704`

## Scope

Reviewed the project after the latest popup/blocklist subdomain fix:

- Architecture boundaries between service worker, popup, blocked page, new tab runtime, options UI, and shared libraries.
- Manifest V3 permissions, DNR ownership, `chrome_url_overrides`, OAuth placeholder behavior, and web accessible resources.
- New tab runtime: search, links, start pinned links, recent history, browser pinned tabs, IP block, Google Calendar, stats, timers, stopwatch, pomodoro, local notes/tasks, and layout rendering.
- Options UI: JSON-backed link/search settings, layout editor, backup controls, blocklist controls, locale switching, and reset behavior.
- Storage/local state/sync/backup/import/export paths: `startPageSettings`, runtime state, `blockedSites`, `lastBlockedUrls`, focus stats, chrome.storage.sync backup, and Google Drive backup.
- i18n EN/RU usage for user-facing states touched by the reviewed flows.
- CI workflow and artifact/cache retention requirements.
- Performance risks: repeated fetches, interval ownership, MutationObserver usage, browser API reads, and cached async calls.
- Security/error handling around user-controlled URL settings and restored backup data.
- UX preservation for existing user settings and local state.

## Finding

Custom links and search providers were accepted from options JSON, backup import, chrome sync restore, and Drive restore as long as their fields were strings.

Affected paths:

- `links.items[].url` is rendered as `anchor.href` in the main links block.
- `startPinned.items[].url` is rendered in pinned link lists.
- `search.providers[].urlTemplate` is used for `location.href` after replacing `{query}`.

The UI is intended for web navigation, but normalization did not restrict these values to absolute HTTP(S) URLs. A malformed or manually edited backup could preserve unsupported or unsafe schemes such as `javascript:`, `data:`, `file:`, `chrome:`, or extension-internal URLs.

Even when Chromium extension CSP blocks some dangerous schemes, keeping them in trusted extension settings is poor security posture and creates inconsistent UX.

## Fix

Updated `src/lib/start-page-settings.ts` normalization:

- Added `safeWebUrl()` for absolute `http:` / `https:` URLs.
- Added `safeWebUrlTemplate()` for search provider templates that include `{query}` and resolve to an absolute `http:` / `https:` URL when the placeholder is replaced.
- `mergeStartLinks()` now keeps only safe web links and trims stored URLs.
- `mergeSearchProviders()` now keeps only safe web search templates.

The fix is intentionally centralized in settings normalization, so it applies consistently to:

- manual options JSON saves;
- backup import;
- chrome.storage.sync restore;
- Google Drive restore;
- direct reads through `getStartPageSettings()`.

## Verification

Expected CI coverage:

- `npm run typecheck`
- `npm run build`
- `npm run build:blocker-only`

Manual reasoning coverage:

- Existing default links/search providers are all HTTP(S) and remain valid.
- Invalid custom link entries are dropped rather than rendered.
- Invalid custom search providers are ignored, leaving default providers available.
- No storage key or schema version change is required.
- `.github/workflows/ci.yml` has no artifact/cache usage, so `retention-days: 1` is not applicable.

## Remaining Risk

Some users could have intentionally stored non-web custom links such as `mailto:` or browser-internal pages. The product already behaves as a web start page and other link lists already filter to HTTP(S), so this is an acceptable compatibility tradeoff for extension-page security. Targeted unit tests for settings normalization would still be useful.
