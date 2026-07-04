# Full Project Audit - Background URL Escape

Date: 2026-07-04
Branch: `codex/full-project-audit-background-url-escape-20260704`
Base: `master`

## Scope

A full project audit pass was performed across:

- architecture and responsibility boundaries;
- new tab runtime and appearance application;
- options/settings UI and background preset manager;
- layout editor and block instance controls;
- site blocking flow and DNR synchronization;
- timers, stopwatch, and pomodoro behavior;
- IP, weather, calendar, search, history, browser pinned, and Start Tab pinned blocks;
- storage, local state, sync, backup, import, and export;
- EN/RU i18n touchpoints;
- Manifest V3 permissions and extension entry points;
- CI, build, and typecheck workflow;
- performance risks from polling, repeated fetches, MutationObserver usage, intervals, and repeated requests;
- security, defensive error handling, and user settings preservation.

## Finding

`src/newtab/newtab.ts` applied `settings.appearance.backgroundImage` directly into a CSS `url("...")` string. The background preset manager already escaped the same value before rendering previews, but the main new tab runtime did not.

If imported or manually edited settings contained quotes or backslashes in the image URL or data URL, the generated CSS value could be malformed and the background image might fail to render.

## Fix

Added a `cssUrl` helper in `src/newtab/newtab.ts` and used it when applying the main new tab background image.

This escapes quotes and backslashes consistently with the background preset manager. No storage schema, backup/import/export shape, preset data, or user settings were changed.

## CI / Build Review

`.github/workflows/ci.yml` was reviewed again. It runs `npm ci`, `npm run typecheck`, `npm run build`, and `npm run build:blocker-only`.

No GitHub Actions artifact upload or explicit dependency cache is configured, so `retention-days: 1` is not applicable.

## Remaining Risks

- `backgroundImage` remains user-controlled through settings/import by design; this change only makes CSS application robust.
- A future hardening pass could add a shared CSS URL helper used by both the TypeScript runtime and static background preset JavaScript.
