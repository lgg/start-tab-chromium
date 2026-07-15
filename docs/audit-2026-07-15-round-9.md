# Deep Audit Round 9 — Runtime Completion, Recovery, and Schema Safety

Date: 2026-07-15
Base: effective production tree from PR #80 (`591c408072ab278ed598daed52a8a8864ab783af`); the audit branch was cut from current `master` at `ceb151258cf20a8fcaf7c661d40141a3680201c3`, whose intervening commits do not change the production tree.

## Scope

This audit independently rechecked the current production architecture after PR #80. It covered instance settings and runtime migration, service-worker clock ownership, Chrome alarms, reset and backup transactions, blocklist/DNR rollback, Browser Sync concurrency, unsupported future schemas, legacy task normalization, generated manifests, all three build profiles, localization/static validation, strict TypeScript, and dependency security.

## Material findings fixed

### Durable clock completion

- A Pomodoro configured to auto-start its next phase persisted the next phase as running but did not create its next Chrome alarm. The service worker now schedules the returned next-phase clock before recording statistics or showing a notification.
- A legacy running Timer or Pomodoro without a completion token could remain stuck at zero. Normalization now assigns a deterministic completion token to any running legacy countdown that lacks one.
- Clock persistence and alarm creation were separate operations. A concurrent backup restore could replace runtime between them, after which a delayed scheduler could install an alarm for stale state. Per-instance scheduling now re-reads compatible persisted runtime under the shared `data-write` lock and aligns alarms only to that current state.

### Backup and reset alarm transactions

- Importing a backup containing active countdowns restored runtime data but did not recreate their alarms, while stale pre-import alarms could remain. Backup import now reconciles alarms from the imported normalized runtime.
- If backup import fails during alarm reconciliation, storage, DNR rules, and the exact previous clock-alarm snapshot are restored.
- Full Start Tab reset rollback previously reconstructed alarms from normalized runtime. It now snapshots and restores exact alarm names, scheduled times, and optional periods, independently of persisted schema versions.

### Exact rollback revisions

- A blocklist mutation or backup import that failed after writing `startTabDataRevision` could restore application data while leaving an advanced revision, producing a false Browser Sync conflict. Both rollback paths now include the data-revision key in the recovery snapshot.

### Cross-context Chrome Sync serialization

- Browser Sync upload, restore, and smart-sync decision/write sequences could race across multiple extension pages. Public sync operations now execute under a shared `chrome-sync` Web Lock while using non-reentrant internal helpers.

### Unsupported future schema protection

- Reads of future settings no longer write migration-report side data.
- Runtime migration and mutation paths now refuse writes when the stored settings schema is newer than the extension understands.
- Future settings reads preserve current and legacy runtime storage rather than normalizing or deleting it.
- Stored alarm reconciliation is performed from one compatible storage snapshot under the `data-write` lock and exits without changing alarms when either settings or runtime uses an unsupported future schema.
- Explicit user-requested full reset remains the intentional recovery path.

### Deterministic legacy task migration

- Empty legacy task IDs could remain empty and fail runtime message validation.
- Duplicate task IDs could address the wrong task.
- Missing-ID fallback previously depended on wall-clock time and caused repeated migration/sync diffs.
- Task normalization now creates non-empty deterministic IDs, resolves duplicates deterministically, and uses deterministic timestamp fallbacks.

## Executable regression coverage added

Round 7 and roadmap fixtures now verify:

- Pomodoro auto-start persists and schedules the next durable alarm;
- delayed alarm scheduling discards a stale token and aligns to the current persisted clock;
- legacy running countdowns receive stable completion tokens;
- active clocks restored from backup receive alarms and stale alarms are removed;
- alarm reconciliation failure restores exact storage, DNR, revision, and alarm state;
- reset rollback preserves alarm name, scheduled time, and period metadata;
- blocklist and backup rollback restore the exact prior data revision;
- Chrome Sync operations use a dedicated cross-context lock;
- future settings prevent runtime writes and alarm side effects;
- future settings reads do not write migration side data or delete legacy runtime;
- damaged and duplicate legacy task IDs normalize to non-empty, unique, deterministic values.

## Clean-room validation

Executed from a clean dependency and build state:

```text
npm ci --no-audit --no-fund --loglevel=error
npm test
npm run typecheck
npm run build
npm run build:blocker-only
GOOGLE_OAUTH_CLIENT_ID=round9-final.apps.googleusercontent.com npm run build:google
npm audit --omit=dev
```

All commands passed. The production dependency audit reported zero known vulnerabilities. Generated full, blocker-only, and Google-enabled packages passed manifest and production-output validation.

## External validation boundary

Repository automation cannot prove real Chrome Web Store review, production Google OAuth and API calls, real multi-device Chrome Sync propagation/quota behavior, browser-specific native-new-tab behavior, or physical pointer/touch/high-DPI/screen-reader testing. Those remain explicit interactive deployment checks in the existing manual QA documentation.
