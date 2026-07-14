# Deep Audit Round 7 — deploy readiness and cross-context data safety

Status: implementation complete; pending GitHub branch/PR merge at the time this record was written.

Base: `master` at `a1b33acd2c06fd89147e2a9bce64f3545d5b630e`.

## Scope

This pass re-audited the complete production surface rather than trusting previous audit reports: settings and runtime persistence, layout and block instances, service-worker ownership, clocks and alarms, blocklist/DNR consistency, backup/import rollback, Browser Sync, Google integration packaging, new-tab and Options mutation paths, localization, Manifest V3 output, full and blocker-only builds, and repository branch/PR completeness.

## Material findings fixed

### Cross-context lost updates

- Added a shared cross-context storage transaction primitive based on Web Locks, with a deterministic per-context fallback for tests and older runtimes.
- Settings and runtime stale checks now occur inside the same transaction as their writes.
- A stale snapshot with timestamp `0` can no longer bypass conflict protection.
- Data revision increments are serialized and remain unique when multiple changes occur in the same millisecond.
- Focus statistics, locale, onboarding, settings, runtime, blocklist and backup-relevant writes participate in the same `data-write` transaction boundary.

### Runtime mutations and reset

- Note, task and link-page messages carry the exact previous value on which the edit was based.
- The service worker rejects an old tab's mutation after another tab or a backup restore changed the persisted value.
- The page reloads the latest persisted runtime after a conflict instead of silently overwriting it.
- Complete Start Tab reset is owned by the service worker and removes current runtime, legacy runtime, migration data and clock alarms together.
- Durable clock actions and clock completion mutate runtime atomically.

### Backup and Browser Sync

- Backup export reads one consistent storage snapshot.
- Import runs under one transaction, normalizes legacy runtime into the recovery snapshot and deletes legacy runtime after successful application.
- A failed apply or DNR synchronization restores the exact previous storage keys, including any earlier pre-import recovery backup.
- Browser Sync passes its remote content revision into import instead of incrementing the data revision twice.
- Unsupported future local or imported schemas remain protected from downgrade writes.

### Blocklist/DNR consistency

- Add, remove, replace and clear operations now treat storage plus dynamic DNR rules as one recoverable transaction.
- If DNR rejects the new rules, original storage and original rules are restored.
- The shared data revision changes only after the complete operation succeeds.
- Rule reconciliation is serialized with blocklist mutations.

### Deployable OAuth packaging

- Default builds no longer ship the placeholder Google OAuth client ID.
- Without `GOOGLE_OAUTH_CLIENT_ID`, generated manifests omit both `oauth2` and the unused `identity` permission.
- A Google-enabled build injects a validated Chrome OAuth client ID from the environment.
- A malformed non-empty ID fails the build instead of producing an ambiguous artifact.
- Release and manual-QA documentation now describe the actual `build/` and `build-blocker-only/` outputs and the build-time OAuth workflow.

### UI correctness

- Options no longer sorts the persisted layout block array in place.
- Theme image previews safely quote URL values.
- Reset in Options delegates to the complete service-worker reset rather than deleting only one runtime key.

## Executable regression coverage

Round 7 fixtures verify:

- simultaneous settings writes produce exactly one winner and one stale conflict;
- simultaneous runtime writes produce exactly one winner and one stale conflict;
- zero-timestamp stale writes are rejected;
- concurrent revision updates are monotonic and unique;
- real service-worker messages reject stale note, task and link-page edits;
- forced DNR failure rolls blocklist storage and rules back without advancing revision;
- exported recovery data includes normalized legacy runtime;
- successful import removes legacy runtime;
- forced import failure restores the previous storage and previous recovery backup;
- complete reset removes both runtime schemas and clock alarms.

## Local clean-room validation

Executed without using GitHub Actions as a readiness signal:

```text
npm ci --no-audit --no-fund --loglevel=error
npm test
npm run typecheck
npm run build
npm run build:blocker-only
GOOGLE_OAUTH_CLIENT_ID=round7-test.apps.googleusercontent.com node build.mjs --outdir=build-google
GOOGLE_OAUTH_CLIENT_ID=round7-test.apps.googleusercontent.com node scripts/validate-build-output.mjs build-google full
```

All commands passed.

Additional checks found no duplicate TypeScript/JavaScript module stems, source maps, `eval`, `new Function`, debugger statements or debug logging in production source. Full output owns `newtab.html`; blocker-only output contains no new-tab override or assets. Default output omits Google OAuth and `identity`; the Google-enabled output contains both with the supplied ID.

## External boundary

Repository-internal automated and static checks cannot prove real Chrome Web Store review, real Google OAuth consent, Calendar/Drive behavior with a production client, physical interaction across every Chromium-derived browser, or real multi-device `chrome.storage.sync` propagation and quota behavior. These remain explicit manual deployment checks rather than being falsely reported as completed.
