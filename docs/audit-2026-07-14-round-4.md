# Deep Audit Round 4

Date: 2026-07-14  
Branch: `codex/final-deep-audit-round-4-20260714`  
Base: `master` at `c73620c62302f02e72b48da5ecbb6e1066852184`  
Pull request: #74

## Why this audit was necessary

The previous rounds fixed genuine defects, but a complete clean-runner source snapshot showed that production builds still traversed compatibility and `v2`/`v3` shadow modules. This audit therefore treated the generated bundles, not filenames or earlier reports, as the source of truth.

## Scope

The review covered:

- the complete TypeScript/JavaScript import graph;
- actual full and blocker-only generated artifacts;
- settings and runtime schema migration;
- unsupported future-schema safety;
- block timestamps and synchronization ordering;
- per-instance timer, stopwatch, Pomodoro, note, task, and link-page state;
- service-worker alarms, notifications, statistics, and mutation ownership;
- layout-editor save/cancel behavior;
- native-new-tab fallback behavior;
- theme creation/edit/cancel behavior;
- backup/import/rollback and optional values;
- browser sync revision ordering;
- Manifest V3, permissions, localization, CSP-safe output, and build wiring.

## Material findings and fixes

### Hidden production dependency graph

Removed obsolete or shadow implementations that could be selected by exact `.js` imports:

- `src/lib/start-page-block-store.ts`
- `src/lib/start-page-theme-store.ts`
- `src/lib/start-page-settings-store.ts`
- `src/lib/start-page-validation-v2.ts`
- `src/newtab/block-renderers.js`
- `src/newtab/block-renderers-v2.ts`
- `src/newtab/block-renderers-runtime-v2.js`
- `src/newtab/block-renderers-runtime-v2.ts`
- `src/newtab/block-renderers-runtime-v3.ts`

The canonical builder now requests an esbuild metafile and fails if any superseded path enters the production graph. Static validation also rejects duplicate `.ts`/`.js` module stems.

### Future-schema data safety

- Reading settings created by a newer extension version no longer writes a downgraded schema back to storage.
- Normalized future settings are exposed as a read-only compatibility view.
- Settings mutation is rejected while an unsupported future schema is stored.
- The same protection now applies to runtime schema versions newer than the supported version.
- Backup migration and export reject unsupported future settings/runtime rather than silently downgrading them.

### Timestamps and sync ordering

- Block `updatedAt` now changes when block content changes.
- Unchanged blocks retain their previous timestamp.
- Global data revision updates are monotonic and cannot move backward.

### Runtime ownership and races

- The service worker is now the sole owner of durable runtime mutations, clock transitions, alarms, completion, notifications, and focus-stat mutations.
- New-tab, Options, and blocked pages send validated messages instead of racing whole-object storage writes.
- Runtime mutations are serialized in one service-worker queue.
- Statistics mutations are serialized in a separate service-worker queue.
- Clock-completion statistics use bounded token deduplication.
- Notification IDs are deterministic per instance and completion token.

### UX and transactional behavior

- Native-new-tab fallback now creates `about:blank`, stores bypass state for the returned tab ID, and only then navigates to the native new-tab URL.
- Layout Editor reloads canonical persisted settings after Save instead of retaining the pre-normalization draft.
- Creating a custom theme is now transactional: Cancel does not leave a persisted theme.
- Duplicate persistence helpers no longer append a hardcoded English suffix.

### Backup correctness

- Missing optional focus statistics remain absent instead of becoming an explicit `undefined` storage value.
- Future settings/runtime in a backup are rejected clearly.
- Existing pre-import recovery and rollback behavior remains intact.

## Regression coverage

Executable fixtures now cover:

- future settings read without overwrite;
- refusal to mutate future settings;
- changed and unchanged block timestamps;
- future runtime read without overwrite or legacy-key deletion;
- refusal to mutate future runtime;
- absent optional focus-stat backup data;
- rejection of future-schema backups;
- bounded completion-token history;
- validation of every new service-worker mutation message.

Build validation verifies that:

- full output contains the Start Tab entry;
- blocker-only output omits every Start Tab file and override;
- `newtab.js` delegates runtime operations and does not create notifications;
- `service-worker.js` owns runtime messages and notifications;
- no output contains `eval`, `new Function`, or source maps.

## Verification performed

GitHub Actions run #293 for implementation head `1ac70c8b91adf57f82225ab2a7ce89f92ff850ee` completed successfully, including:

- `npm run test`
- `npm run typecheck`
- `npm run build`
- `npm run build:blocker-only`

A complete one-day source/build artifact from that exact clean runner was downloaded and manually inspected. Results:

- 33 source modules were present;
- 32 modules were reachable from production entry points;
- the remaining JavaScript file was the intentionally copied static new-tab gate;
- no missing imports or unreachable production modules were found;
- no duplicate TypeScript/JavaScript module stems remained;
- no obsolete `v2`/`v3` implementation entered source or build output;
- full build contained 23 files;
- blocker-only build contained 19 files;
- manifests and variant boundaries were correct;
- generated new-tab code contained service-worker delegation but no notification creation;
- generated service-worker code contained clock/stat ownership and notification creation;
- no source maps, `eval`, `new Function`, debugger statements, debug logging, or unfinished markers were found.

## External verification boundary

No unresolved repository-internal critical or high-priority defect was found after the final artifact audit. The following still require their real external environments and are not falsely reported as physically executed here:

- interactive Chromium drag/resize/keyboard/high-DPI behavior;
- real permission and notification prompts;
- production Google OAuth, Calendar, and Drive calls;
- real cross-device `chrome.storage.sync` propagation and quota behavior;
- Chrome Web Store packaging and review.

The reproducible manual browser checklist remains in `docs/manual-qa-3.0.0.md`.
