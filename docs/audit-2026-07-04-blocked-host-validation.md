# Full project audit: blocked page host validation

Date: 2026-07-04
Branch: `codex/full-project-audit-blocked-host-20260704`

## Scope checked

This pass reviewed the current `master` after the compact URL rendering fix. The pass covered:

- extension architecture and responsibility split between MV3 service worker, blocklist library, blocked page, popup, options UI, new tab runtime, and shared storage modules;
- blocked navigation runtime, DNR redirect flow, popup unblock/block status, last blocked URL restore, and focus statistics;
- new tab runtime blocks: search, links, recent history, browser pinned, start pinned, IP, weather placeholder, Google Calendar, timers, stopwatch, pomodoro, commands, and stats;
- options UI save/import/export/sync flows and layout editor persistence;
- storage/local state/sync/backup compatibility;
- i18n EN/RU paths around blocked page and affected UI;
- manifest permissions, MV3 web accessible resources, and CI workflow;
- performance risks around intervals, MutationObserver, repeated fetches, and repeated storage writes;
- security/error handling and preservation of user settings.

## Finding

`blocked.html` is declared as a web-accessible resource because DNR redirects blocked top-level navigations to it. The normal DNR path generates `?site=` from a normalized blocked host, but a web-accessible extension page can also be opened directly with an arbitrary `site` query parameter.

The blocked page previously used `normalizeHost()` on that parameter, which trims/lowercases but does not fully validate that the value is a blockable HTTP(S) host. Invalid direct URLs could therefore render a misleading blocked page state and leave the unblock button available until the service worker rejected the invalid host.

## Fix

Changed `src/blocked/blocked.ts` so the `site` parameter is accepted only if it round-trips through the shared `hostFromUrl()` HTTP(S) host parser. Invalid values now produce the unknown-site blocked page state and disable the unblock button.

The normal DNR flow remains unchanged because DNR still passes already-normalized hosts from the blocklist rules.

## Verification

- Reviewed blocked page, blocklist normalization, DNR redirect construction, popup unblock behavior, focus stats recording, and last blocked URL restore.
- Confirmed the change does not add polling, fetches, new permissions, or storage writes.
- CI workflow still runs typecheck and both extension builds.
- `.github/workflows/ci.yml` has no artifact/cache usage, so `retention-days: 1` is not applicable.

## Remaining risk

There is no dedicated browser e2e test for manually opened `blocked.html?site=...` URLs. CI currently verifies TypeScript typecheck and production builds.
