# Full Project Audit - Options Helper Guard

Date: 2026-07-04
Branch: `codex/full-project-audit-options-helper-guard-20260704`
Base: `master`

## Scope

A full project audit pass was performed across the extension surface:

- architecture and responsibility boundaries;
- new tab runtime;
- options/settings UI;
- layout editor;
- site blocking flow;
- timers, stopwatch, and pomodoro behavior;
- IP, weather, calendar, search, history, and pinned blocks;
- storage, local state, sync, backup, import, and export;
- EN/RU i18n coverage touchpoints;
- Manifest V3 permissions and extension entry points;
- CI, build, and typecheck workflow;
- performance risks from polling, repeated fetches, MutationObserver usage, intervals, and repeated requests;
- security, defensive error handling, and user settings preservation.

## Finding

The options helper script adds progressive UI enhancements around Start Tab options, layout extras, backup grouping, weather coordinate inputs, and the IP provider selector.

Several async helper actions were intentionally launched as fire-and-forget operations from UI events and delayed reapply hooks. If `chrome.storage.local` failed, the options page was torn down while a storage operation was pending, or a browser runtime error surfaced during an enhancement, those promises could reject without a local handler.

Impact:

- possible unhandled promise rejection noise in the options page;
- progressive helper state could fail noisily even though the typed options UI should remain usable;
- settings persistence was otherwise correct, but the helper layer did not isolate its optional behavior from the main form strongly enough.

## Fix

Updated `src/options/options-helper.js` to add a small `runHelperAction` wrapper for progressive async helper work.

The wrapper now catches both synchronous throws and promise rejections for optional helper actions used by:

- IP provider selection;
- layout mode, layout zone, and show-title controls;
- deferred layout patch reapply after form submit;
- deferred IP endpoint reapply after form submit;
- initial layout extra injection;
- initial IP provider field injection.

This keeps the existing storage schema and user settings behavior unchanged. No feature was removed.

## CI / Build Review

`.github/workflows/ci.yml` was checked during the audit.

The workflow runs:

- `npm ci`;
- `npm run typecheck`;
- `npm run build`;
- `npm run build:blocker-only`.

No GitHub Actions artifact upload or explicit dependency cache is configured, so `retention-days: 1` is not applicable in this repository at this time.

## Remaining Risks

- The options helper remains a DOM enhancement layer over the typed options page. A deeper future cleanup could move these progressive controls into the typed options implementation directly.
- The current fix intentionally avoids changing storage shape, import/export behavior, or layout semantics to minimize regression risk for existing users.
