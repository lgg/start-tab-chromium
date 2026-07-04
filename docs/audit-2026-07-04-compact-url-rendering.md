# Full project audit: compact URL rendering

Date: 2026-07-04
Branch: `codex/full-project-audit-url-rendering-20260704`

## Scope checked

This pass reviewed the current `master` after the previous backup import fix. The pass covered:

- architecture and responsibility split across the MV3 service worker, shared libraries, popup, options UI, new tab runtime, and static scripts;
- new tab runtime rendering, dynamic blocks, compact URL blocks, search, history, browser pinned tabs, start pinned links, calendar, IP, weather placeholder, commands, and stats;
- options UI settings persistence, JSON editors, layout editor, backup/import/export, chrome sync, and Google Drive restore paths;
- blocklist behavior, DNR sync, blocked URL memory, popup status, and focus stats;
- timers, stopwatch, pomodoro, notification behavior, state saving, and interval usage;
- storage/local state/sync/backup compatibility;
- i18n EN/RU usage around affected runtime UI;
- manifest permissions, MV3 requirements, and CI workflow;
- performance risks around repeated fetches, polling, intervals, and rendering loops;
- security/error handling and preservation of user settings.

## Finding

The compact URL blocks (`recent`, `browserPinned`, and `startPinned`) used a string-prefix filter:

- `item.url.startsWith("http://")`
- `item.url.startsWith("https://")`

Settings normalization already validates custom links with `new URL()`, which accepts valid mixed-case schemes such as `HTTPS://example.com`. Those links could remain valid in storage but be hidden by the compact runtime renderer because the renderer used a case-sensitive prefix check instead of URL parsing.

This could happen through manual JSON edits, backup import, sync restore, or older stored data.

## Fix

Changed `src/newtab/newtab.ts` so compact URL rendering now validates links through `new URL()` and accepts only `http:` and `https:` protocols. The renderer also trims the URL before assigning it to the anchor.

This keeps the existing safety boundary while making runtime rendering consistent with settings normalization.

## Verification

- Reviewed start pinned links, browser pinned tabs, recent history rendering, settings normalization, backup restore paths, and compact list rendering.
- Confirmed the change does not add polling, repeated fetches, or additional storage writes.
- CI workflow still runs typecheck and both extension builds.
- `.github/workflows/ci.yml` has no artifact/cache usage, so `retention-days: 1` is not applicable.

## Remaining risk

There is no dedicated browser e2e test for compact block rendering with restored mixed-case URLs. CI currently verifies TypeScript typecheck and production builds.
