# Full Project Audit - Instance Timezone Guard

Date: 2026-07-04
Branch: `codex/full-project-audit-instance-timezone-guard-20260704`
Base: `master`

## Scope

A full project audit pass was performed across the extension surface:

- architecture and responsibility boundaries;
- new tab runtime and block instance overrides;
- options/settings UI and layout editor;
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

`src/newtab/instances.js` allows per-block configuration for instance `dateTime` blocks. The block settings prompt accepts a custom IANA time zone string, for example `Europe/Amsterdam`.

If a user entered an invalid time zone, `Intl.DateTimeFormat` could throw a `RangeError` during `patchDateTime`. That function runs during instance runtime setup and every one-second tick when dynamic blocks are enabled.

Impact:

- the affected instance date/time block could stop rendering correctly;
- a thrown formatter error could interrupt the instance runtime tick before clock updates were processed;
- the issue lives in a static JS asset copied into the build, so TypeScript cannot catch it.

## Fix

Updated `src/newtab/instances.js` to add a `formatDateTime` helper.

The helper tries to format with the configured `timeZone` first. If the browser rejects it, formatting falls back to the browser-local time zone by removing only the invalid `timeZone` option.

This keeps user settings unchanged and avoids silently overwriting the user's saved block config. The runtime simply remains usable even when the saved value is invalid.

## CI / Build Review

`.github/workflows/ci.yml` was reviewed again. It runs:

- `npm ci`;
- `npm run typecheck`;
- `npm run build`;
- `npm run build:blocker-only`.

No GitHub Actions artifact upload or explicit dependency cache is configured, so `retention-days: 1` is not applicable.

## Remaining Risks

- `src/newtab/instances.js` is still plain JavaScript copied as a static asset. A future hardening pass should migrate it into a typed entry point.
- The block configuration UI still uses browser prompts. A future UX pass could replace prompts with typed controls and validate time zones before saving.
