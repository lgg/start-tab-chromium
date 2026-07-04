# Max Autonomous Audit - Static Validation Coverage

Date: 2026-07-04
Branch: `codex/max-autonomous-hardening-static-tests-20260704`
Base: `master`

## Scope

This pass focused on the work that can be safely completed without product-owner input or manual browser QA:

- README roadmap and current feature documentation;
- recent merged PRs and current open PR state;
- Manifest V3 structure and required extension entry points;
- CI/build/typecheck workflow;
- EN/RU i18n catalog consistency;
- static files copied by the build pipeline;
- release-artifact/cache retention expectations;
- preservation of existing storage schemas, backup/import/export payloads, and user settings.

Runtime areas were rechecked at the level available through source review: new tab runtime, options UI, layout editor, site blocking/DNR, timers, IP/weather/calendar/search/history/pinned blocks, sync/backup/import/export, and progressive static helper scripts.

## Finding

The project had build and typecheck coverage but no automated test command in `package.json`. Several high-risk invariants were therefore only reviewed manually:

- EN/RU message catalogs exposing the same keys;
- all static assets referenced by the build script existing in the repository;
- the full build manifest retaining the Start Tab new-tab override;
- required MV3 service worker and permission invariants;
- CI continuing to avoid artifact/cache retention drift.

This left regressions in localization, static asset paths, manifest wiring, or CI policy detectable only during manual review or browser loading.

## Fix

Added a dependency-free static validation suite:

- `scripts/validate-static.mjs` checks locale catalog parity, manifest invariants, package scripts, static build assets, and CI policy.
- `npm test` now runs the validator.
- GitHub Actions now runs `npm run test` before `typecheck` and both extension builds.

No runtime storage keys, settings schema, backup schema, sync metadata, manifest permissions, or feature behavior were changed.

## CI / Artifact Review

`.github/workflows/ci.yml` still does not use `actions/upload-artifact` or `actions/cache`. The new validator enforces that any future artifact upload must declare `retention-days: 1`, and it fails on explicit `actions/cache` usage.

## Remaining Manual QA

The following still require real browser/manual verification and cannot be honestly completed through static CI alone:

- loading the full unpacked extension in target Chromium browsers;
- Comet/browser-specific new-tab fallback behavior;
- Google OAuth client ID setup, Calendar block, and Drive backup/restore;
- actual `chrome.storage.sync` quota behavior across browser profiles;
- DNR redirect behavior on real blocked navigations;
- notification permission behavior for timers/Pomodoro.

## Roadmap Status Note

The README roadmap still contains larger product/architecture work: complete instance-based blocks, a full block palette, deeper per-instance settings panels, and a broader theme system. Those are not safe to claim as fully completed in this audit-only hardening pass without additional product decisions and a larger migration plan.
