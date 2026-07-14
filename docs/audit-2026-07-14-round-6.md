# Deep Audit Round 6

Status: completed and merged

Base audited: `master` at `0ae7d4ea201655c91a99c5c798b6ed7e0a81f025`

Audited branch head: `70b4313cb3c933d0df74d8ba19a8f5236c339faf`

Merged by PR [#76](https://github.com/lgg/start-tab-chromium/pull/76) as squash commit `99b4dfbc5cdb8821344770803d729ed4369e559c`.

## Scope

This audit independently verified the actual repository state after PR #75 and found that its merged diff did not contain the source changes described in its report. Round 6 therefore reproduced the missing issues against the real code and applied the production fixes in a new branch.

The merged change contains 19 files with production code, executable regression fixtures, build-output validation, CI snapshot improvements, and this audit record.

## Main fixes

- safer initial Chrome Sync behavior that does not overwrite an existing remote snapshot with clean-device defaults;
- deterministic sync checksums, conflict handling, and orphan chunk cleanup;
- serialized blocklist and declarativeNetRequest mutations;
- retryable legacy blocklist migration after transient storage failures;
- stale-write protection for settings and runtime snapshots;
- complete reset of current and legacy runtime data together with clock alarms;
- service-worker ownership of durable clock, statistics, and native-new-tab operations;
- MV3-safe asynchronous request handling through `runtime.sendMessage` and an open response channel;
- browser-specific native-new-tab fallback handling;
- cached external requests and detached-DOM guards in asynchronous renderers;
- locale fallback behavior;
- executable regression fixtures and validation of generated full and blocker-only builds.

## Local validation

The exact remote head snapshot `70b4313cb3c933d0df74d8ba19a8f5236c339faf` was downloaded and validated locally. GitHub Actions was not used as the merge-readiness criterion.

Successful commands:

- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run build:blocker-only`

Additional checks confirmed that the full build contains the new-tab override, the blocker-only build omits it and its assets, both manifests remain MV3 version 3.0.0, and production bundles contain neither `eval` nor `new Function`.

## External validation not claimed

Real-account Google OAuth, Drive and Calendar flows, physical testing across multiple Chromium-derived browsers, and real multi-device synchronization require external environments and were not represented as completed by this audit.
