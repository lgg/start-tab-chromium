# Full Project Audit - Popup Subdomain Block Status

Date: 2026-07-04
Branch: `codex/full-project-audit-settings-hash-20260704`

## Scope

Reviewed the extension after the latest blocklist/storage hardening pass:

- Manifest V3 configuration, permissions, DNR rule ownership, service worker startup and message handling.
- Popup runtime and block/unblock UX for active tabs.
- Blocked page redirect/countdown flow and last blocked URL storage.
- New tab runtime: layout rendering, clock interval ownership, timer/stopwatch/pomodoro state, notes/tasks, search, links, recent history, browser pinned tabs, start pinned links, stats, and Google Calendar loading.
- Options UI: tab sections, layout editor, backup/import/export controls, locale switching, blocklist textarea, and JSON-backed settings.
- Shared storage: start page settings normalization, runtime state normalization, focus stats, blocklist normalization, backup import/export, chrome.storage.sync backup, Google Drive backup.
- i18n EN/RU usage for existing user-facing states.
- CI/build/typecheck workflow and artifact/cache retention requirements.
- Performance risks around repeated fetches, intervals, polling, MutationObserver usage, and repeated browser API calls.
- Security/error handling around user-controlled URLs, restored storage values, and extension navigation.
- UX preservation for existing local settings and user state.

## Finding

The popup used exact array membership to decide whether the active tab was blocked:

```ts
(await getBlockedSites()).includes(host)
```

That did not match the DNR/blocklist semantics. DNR blocks a stored host and its subdomains, and shared blocklist logic already exposes `blockedSiteForUrl()` for the same host/subdomain matching rule.

Example failure:

- Stored blocklist contains `example.com`.
- Active tab is `https://sub.example.com/`.
- DNR correctly treats the tab as blocked by `example.com`.
- Popup showed the block action instead of the unblock action, because `sub.example.com` was not exactly present in the stored list.

This could lead to duplicate, narrower blocklist entries and confusing UX.

## Fix

Updated `src/popup/popup.ts` to use `blockedSiteForUrl(tab.url)` instead of exact `getBlockedSites().includes(host)` matching.

Behavior after the fix:

- If the active tab is blocked directly, popup unblocks that stored host.
- If the active tab is blocked by a parent domain, popup unblocks the parent stored host.
- If the active tab is not blocked, popup still blocks the normalized active host.
- Unsupported/internal pages still show the unsupported-page state.

The storage schema and user settings are unchanged.

## Verification

Expected CI coverage:

- `npm run typecheck`
- `npm run build`
- `npm run build:blocker-only`

Manual reasoning coverage:

- `blockHost()` and `unblockHost()` still receive normalized host strings.
- `blockedSiteForUrl()` is the same matching function used by blocked navigation flow.
- No i18n key changes were required.
- `.github/workflows/ci.yml` has no artifact/cache usage, so `retention-days: 1` is not applicable.

## Remaining Risk

The project still has no dedicated automated tests for popup blocklist subdomain behavior. CI validates typing/build integration, but a future regression in blocklist matching would be easier to catch with targeted unit tests around `blockedSiteForUrl()` and popup rendering decisions.
