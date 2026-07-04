# Full project audit: IP lookup guard

Date: 2026-07-04
Branch: `codex/full-project-audit-ip-lookup-guard-20260704`
Base: current `master` after PR #63

## Scope

Reviewed the current project end to end: architecture and responsibility split, MV3 service worker and DNR ownership, popup, blocked page, new tab runtime, options UI, layout editor, site blocking, timers/stopwatch/pomodoro, IP/weather/calendar/search/history/pinned blocks, storage/local state/sync/backup/import/export, EN/RU i18n, manifest permissions, CI/build/typecheck, performance risks from polling/fetch/MutationObserver/interval usage, security/error handling, UX, and preservation of user settings.

## Latest 50 changes reviewed

Reviewed the latest 50 merged PR changes visible in the repository history: PR #14 through PR #63.

- PR #14: CI cache storage cleanup. Correctly removed cache growth without adding cleanup scripts; no artifacts are uploaded, so `retention-days` is not applicable.
- PR #15-#16: focus stats and runtime state normalization. Correctly protects restored/imported state from NaN counters and malformed timers.
- PR #17-#21: options tabs, new tab diagnostics, Comet fallback, onboarding persistence, layout editor. Current source preserves runtime toggles, layout state, and onboarding state without changing the backup schema unexpectedly.
- PR #22-#26: background presets, layout zone/full-width behavior, IP provider selection, settings polish. Current source keeps large uploads in local storage, validates URL-like inputs, and avoids CI cache/artifact churn.
- PR #27-#29: block instance manager, instance refresh, Comet split-view picker handling. Current source keeps instance state separate and avoids redirecting known native split-view picker URLs.
- PR #30-#39: repeated 10-pass audit fixes around storage, sync, blocked page, worker, onboarding/i18n, and gate/runtime hardening. Current source keeps the fixes scoped and compatible with existing storage.
- PR #40-#49: gate/options/blocked/layout/import normalization and command/import hardening. Current source continues to centralize normalization and preserve valid user data.
- PR #50-#60: blocked URL normalization, subdomain popup matching, safe links/search/IP endpoints, partial import preservation, URL rendering, blocked host validation, Chrome sync metadata, calendar input normalization, and multi-placeholder search templates. Current source reflects the intended validations without permission drift.
- PR #61-#63: popup async hardening, instance async hardening, and new tab core async hardening. Current source guards the main async action surfaces while preserving UX and local state.

No rollback-worthy issue was found in those recent changes. The remaining confirmed bug was in an older helper path still present after the recent hardening sequence.

## Finding

`src/newtab/ip.js` used `lookupPromise = performLookup()` and then invoked it fire-and-forget from `queueRenderOrLookup()`. Provider failures were caught inside the provider loop, but failures before that loop, especially `chrome.storage.local.get()` inside `readEndpoint()`, could reject the whole promise. That left the IP block in a loading state and could create an unhandled promise rejection.

## Fix

- Added `markUnavailable()` as the single unavailable-state path.
- Reused it at the end of provider fallback exhaustion.
- Added `.catch(markUnavailable)` when creating `lookupPromise`.
- Kept the one-shot lookup/cache behavior unchanged, so there is no added polling or fetch spam.

## Safety

- No storage keys were added, removed, renamed, or migrated.
- No backup, sync, import, or export schema changed.
- No manifest permissions changed.
- No features were removed.
- Existing settings, layout state, runtime state, IP endpoint settings, backups, and sync payloads remain compatible.
- CI workflow has no Actions artifacts/cache configuration; `retention-days: 1` is not applicable.

## Remaining risks and technical debt

- External IP providers can still fail or rate-limit independently; the UI now reliably falls back to the localized unavailable message.
- `src/newtab/instances.js` still duplicates layout metadata from `src/lib/start-page-settings.ts`; consolidating that should be a dedicated typed-module cleanup.
- Plain JavaScript helper layers still contain fallback English strings next to `chrome.i18n` lookups; safe at runtime, but less complete than the typed EN/RU UI surface.
