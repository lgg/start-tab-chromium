# Deep Audit Round 7

Status: completed locally; merge tracked by the associated GitHub pull request

Base audited: `master` at `a1b33acd2c06fd89147e2a9bce64f3545d5b630e`

Audit branch: `codex/deep-audit-round-7-deploy-ready-20260714`

## Scope

This pass re-audited the real merged production tree after PRs #76 and #77. It covered settings and runtime persistence, backup/import rollback, Chrome Sync conflict resolution, blocklist and DNR ownership, durable clocks and alarms, native-new-tab handling, Layout Editor concurrency, asynchronous rendering, localization, generated full/blocker-only packages, and repository/PR state.

GitHub Actions was not used as a readiness criterion. Validation was performed locally from a clean copy with a fresh `npm ci`.

## Confirmed findings and fixes

### Cross-context persistence

- Added a shared Web Locks based storage critical section, with a deterministic per-context fallback.
- Settings and runtime stale checks now occur in the same critical section as their writes.
- Data revisions remain in the existing versioned storage shape and advance monotonically.
- Blocklist, statistics, locale, onboarding, backup, reset, and runtime mutations participate in the same data-write ordering where relevant.

### Backup and restore safety

- Direct JSON exports now normalize every managed storage value, not only settings and runtime.
- Pre-import recovery includes normalized legacy runtime data.
- Successful imports remove legacy runtime state.
- Failed imports roll back exact managed storage, the previous recovery snapshot, data revision, DNR rules, and clock alarms, including when the original profile was empty or the failure occurred after a partial write.
- Imported running timers immediately rebuild their durable alarms.
- Full Start Tab reset now writes settings and runtime together and rolls back storage and alarms after a partial failure.

### Chrome Sync

- Upload, restore, and smart-sync operations are serialized across extension contexts.
- Bundle content and its revision are captured from one atomic snapshot.
- Export time no longer changes `contentUpdatedAt`; unchanged content keeps a stable revision.
- Legacy profiles without a revision do not fabricate recency. When an existing remote snapshot is present, Smart Sync prefers it and preserves the local profile as the pre-import recovery backup.
- Existing protections for deterministic checksums, clean-device restoration, conflict resolution, and orphan chunk cleanup remain covered by executable fixtures.

### Runtime and clocks

- Note, task, and link-page mutations carry optimistic preconditions and compare-and-write atomically in the service worker.
- A stale tab cannot silently overwrite data restored by backup or changed in another tab.
- Clock runtime persistence and alarm updates happen inside one ordered operation.
- Completion, reset, deletion, import, rollback, and startup reconciliation remove stale alarms and preserve the current durable alarm set.
- Conditional instance cleanup cannot delete data for a block restored concurrently.

### Native new tab

- Native-new-tab bypass state is now a bounded per-tab TTL map.
- Observing the first navigation event no longer consumes the bypass, so later status-only `tabs.onUpdated` events cannot immediately redirect the same native tab back to Start Tab.
- Browser-specific fallback attempts remain serialized and require an observed native navigation.

### UI concurrency and errors

- Layout Editor distinguishes its own save from external settings changes.
- External changes update the persisted baseline while preserving an active draft, so Cancel returns to the latest saved state.
- Layout save finalizes persisted editor state before best-effort runtime cleanup.
- Options ignores stale asynchronous statistics renders.
- Asynchronous block actions report errors instead of silently swallowing them.
- External-data renderers cache requests and guard detached DOM updates.

### Deployment packaging

- Removed the placeholder OAuth client from the source manifest.
- Default full and blocker-only builds omit OAuth and the `identity` permission.
- A Google-enabled build requires a valid `GOOGLE_OAUTH_CLIENT_ID` and fails early for placeholders or malformed IDs.
- Blocker-only now omits the unused `history` permission and hides/disables Start Tab-only controls in Options.
- Added generated-manifest validation for OAuth/permission consistency and a dedicated deployment guide.

### Regression coverage

- Added executable Round 7 fixtures for Web Lock serialization, concurrent stale writers, stable revisions, normalized exports, sync serialization, safe first sync, empty-state rollback, post-revision rollback, reset rollback, alarm restoration, imported running clocks, and conditional runtime cleanup.
- Added static guards for lock ownership, transaction boundaries, optimistic preconditions, duplicate operations, native bypass lifetime, Layout Editor external baselines, and generated build invariants.

## Validation performed

The final source tree passed 25 consecutive Round 7 race/rollback fixture runs and then a full clean-room validation from a separate directory:

- `npm ci --no-audit --no-fund --loglevel=error`
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run build:blocker-only`
- `GOOGLE_OAUTH_CLIENT_ID="1234567890-abcdefghijklmnopqrstuvwxyz123456.apps.googleusercontent.com" npm run build:google`
- invalid/placeholder OAuth build rejection

Additional checks confirmed:

- both generated manifests are Manifest V3 version `3.0.0`;
- the full package contains `chrome_url_overrides.newtab`;
- the blocker-only package omits the new-tab override and new-tab assets;
- generated bundles contain neither `eval` nor `new Function`;
- source contains no debugger statements or unfinished `FIXME`, `HACK`, or `XXX` markers;
- 34 TypeScript modules have no import cycles;
- no workflow or package-lock change is part of this audit;
- the default manifests contain no placeholder credentials;
- blocker-only omits `history`, while the full profile retains it for Recent History.

## Repository state checked before the branch

- no open pull requests were present;
- all 77 existing pull requests were closed as merged;
- the GitHub branch-search connector returned no results even for `master`, so it was treated as unreliable and was not used as proof that physical stale refs were absent.

After merge, the authoritative completion checks are: the audit PR is merged, its squash commit is the current `master` head, and no open pull requests remain.

## External validation not claimed

Real-account Google OAuth, Drive and Calendar behavior, real multi-device Chrome Sync, and physical testing across multiple Chromium-derived browsers require external interactive environments. The code paths, error handling, transaction boundaries, generated packages, and local mocks were audited, but those external integrations are not represented as physically exercised in this pass.
