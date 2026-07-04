# Full project audit: layout id normalization

Date: 2026-07-04
Branch: `codex/full-project-audit-layout-id-normalization-20260704`
Base: `master`

## Scope

Reviewed the full extension surface: MV3 manifest and permissions, service worker, new tab runtime and instance layout runtime, options UI, layout editor, site blocking, timer/stopwatch/pomodoro, IP/weather/calendar/search/history/pinned blocks, storage/local state/sync/backup/import/export, EN/RU i18n, CI/build/typecheck configuration, performance risks from polling/fetch/MutationObserver/interval usage, security/error handling, and user settings preservation.

## Finding

`mergeLayoutBlocks()` normalized block fields and appended missing default blocks, but it did not ensure unique `layout.blocks[].id` values. If a user manually edited layout JSON, imported a corrupted backup, or duplicated IDs outside the UI, multiple blocks could share the same id. The new tab runtime and options layout editor use block ids for DOM dataset lookup, update targeting, drag/drop, and block lookup, so duplicate ids could make edits apply to the wrong block or make rendered cards ambiguous.

## Fix

- Added unique layout block id normalization in `src/lib/start-page-settings.ts`.
- Empty block ids now fall back to the block type.
- Duplicate ids now receive a stable numeric suffix during normalization, for example `links`, `links-2`, `links-3`.
- Existing valid unique ids remain unchanged.

## Safety

- No storage schema changes.
- No manifest permission changes.
- No feature removal.
- Existing valid user layouts keep the same block ids.
- The fix only normalizes invalid/colliding layout ids when settings are read through the central settings normalizer.
- CI workflow has no artifacts/cache retention configuration; `retention-days: 1` is not applicable.

## Remaining risks and technical debt

- `src/newtab/instances.js` still duplicates default layout metadata from `src/lib/start-page-settings.ts`; future work should consolidate the layout source of truth.
- Browser-specific native new tab and split-view behavior still depends on Chromium-derived browser internals, though failure handling is guarded.
- External IP/weather/calendar providers can fail independently of extension code; current behavior remains best-effort.
