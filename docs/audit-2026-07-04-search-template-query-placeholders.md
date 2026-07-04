# Audit report: Search template query placeholders

Date: 2026-07-04
Branch: `codex/full-project-audit-search-template-query-20260704`
Base: `master`

## Scope checked

This audit pass reviewed the main areas that can affect correctness, safety, performance, and user settings preservation:

- Architecture and responsibility split between shared settings normalization, new tab runtime, options UI, service worker, popup, blocked page, backup/sync, and Google integration.
- New tab runtime rendering and state handling for search, links, timers, stopwatch, pomodoro, notes, local tasks, IP, weather, calendar, history, browser pinned, Start Tab pinned, commands, and stats blocks.
- Options UI flows for custom search providers, links JSON, pinned links JSON, layout editor state, blocklist, backup/import/export, Chrome sync, Drive backup, locale preference, and reset behavior.
- Layout editor normalization and preservation of existing user-created block settings.
- Site blocking through Manifest V3 DNR, last blocked URL handling, popup integration, and blocked page actions.
- Timer/stopwatch/pomodoro state persistence and focus stats updates.
- Storage/local state/sync/backup/import/export behavior with emphasis on not removing user keys or silently corrupting settings.
- i18n EN/RU loading and fallback behavior.
- Manifest V3 permissions and service worker event usage.
- CI/build/typecheck workflow. The workflow does not use Actions artifacts/cache, so `retention-days: 1` is not applicable in this revision.
- Performance-sensitive paths for repeated fetches, runtime caches, intervals, polling, MutationObserver usage, and repeated storage reads.
- Security and error handling for user-provided URLs, search templates, endpoints, backup payloads, and extension pages.
- UX preservation of existing settings and local runtime state.

## Finding

Custom search provider templates were handled inconsistently when a template contained more than one `{query}` placeholder. Settings validation checked the template by replacing only the first placeholder, and the new tab runtime also replaced only the first placeholder before navigation. A provider such as `https://example.com/search?q={query}&text={query}` could therefore be rejected or navigate with a literal `{query}` left in the URL.

## Fix

- `src/lib/start-page-settings.ts` now validates search URL templates by replacing all `{query}` placeholders before URL validation.
- `src/newtab/newtab.ts` now replaces all `{query}` placeholders with the encoded query at submit time.

## User state impact

No storage keys, settings schema, backup schema, or default provider IDs changed. Existing valid templates continue to work. Multi-placeholder custom templates now work as users would expect.

## Remaining risks

- There are still no dedicated unit tests for custom search provider edge cases; CI covers typecheck and both extension builds.
- Options UI still accepts custom providers as JSON, so invalid JSON remains a user-facing validation path rather than a structured form flow.
