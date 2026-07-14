# Start Tab 3.0.0 release notes

## Summary

Start Tab 3.0.0 completes the instance-based dashboard roadmap. The new-tab page, Options, persistence, runtime state, backup, sync, themes, migration, localization, and build pipeline now use a shared typed architecture.

## Architecture

### Storage schema 4

`startPageSettings` now stores:

- Global Start Tab, settings-button, focus-statistics, layout, and theme selection settings.
- A versioned `layout.blocks` array.
- Stable block IDs.
- Grid and free-position geometry on every instance.
- A discriminated configuration union keyed by block type.
- Built-in theme selection and validated custom themes.

### Runtime schema 2

`startPageRuntimeState` stores independent state keyed by instance ID:

- `clocks` for Timer, Stopwatch, and Pomodoro.
- `notes` for Note blocks.
- `tasks` for Local Tasks blocks.
- `linkPages` for paged link collections.

Clock runtime uses persisted timestamps, target times, completion tokens, and Chrome alarms.

### Backup schema 4

The full backup includes:

- Block instances and both coordinate models.
- Runtime state.
- Selected and custom themes.
- Blocklist and last blocked URLs.
- Locale preference and onboarding state.
- Focus statistics.

Import migrates older bundles, validates normalized storage, records a pre-import recovery backup, and rolls back if the apply operation fails.

## User-visible changes

- Multiple independent Date & Time, IP, Links, Search, Timer, Stopwatch, Pomodoro, Note, Local Tasks, Google Calendar, Weather, and Start Tab Pinned blocks.
- Singleton protection for Commands, Recent History, Browser Pinned Tabs, and Focus Statistics.
- Complete inline Layout Editor with add, configure, duplicate, delete, enable/disable, drag, resize, keyboard editing, save, and cancel.
- Grid and Free modes.
- Contained Page and Full Viewport zones.
- Shared per-instance settings editor in Start Tab and Options.
- Built-in and custom themes with tile-based backgrounds.
- Animated gradient, aurora, mesh, spotlight, noise, Matrix, and cyberpunk effects.
- Standalone custom-theme import/export.
- Full settings dashboard without raw user-facing JSON editors.
- Browser Sync and Google Drive restore for the new schemas.
- Complete English and Russian strings for the new functionality.

## Migration behavior

On first read of an older settings object:

1. The previous version is detected.
2. Known block entries are normalized into typed instances.
3. Stable IDs are preserved when safe; missing or conflicting IDs are replaced.
4. Singleton duplicates are skipped.
5. Layout coordinates, sizes, zone, enabled state, and order are normalized.
6. Per-type settings are validated and clamped.
7. Existing runtime data is mapped to the first corresponding legacy instance, then stored by the new stable ID.
8. Unknown or damaged elements are reported and skipped without discarding valid siblings.
9. The normalized schema is persisted.
10. Legacy runtime storage is removed only after successful persistence.

Migration is idempotent: reading an already migrated schema does not append duplicate blocks or repeat the legacy mapping.

## Recovery behavior

- Invalid optional fields fall back to typed defaults.
- Invalid coordinates and dimensions are clamped.
- Unknown enum values are replaced with supported defaults.
- Invalid URLs and templates produce validation issues instead of being stored silently.
- Import never applies an unrecognized Start Tab bundle as arbitrary storage.
- The last local state before import is available through the recovery action in Options.

## Validation executed for this release branch

The following commands are required and are run from a clean downloaded branch archive:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run build:blocker-only
```

`npm test` additionally executes schema/runtime fixtures and static checks for MV3, localization parity, remote-script exclusion, typed instance architecture, backup versioning, Browser Sync chunk/checksum behavior, and manifest generation.

## Packaging differences

### Full

- Output: `build/`
- Contains `newtab.html`, `newtab.js`, shared Start Tab assets, and `chrome_url_overrides.newtab`.

### Blocker-only

- Output: `build-blocker-only/`
- Does not bundle the new-tab entry point.
- Generated manifest does not contain `chrome_url_overrides`.
- Popup, blocked page, Options, service worker, blocklist, backup, and statistics remain available.

## OAuth

The default build is deployable without Google integration: the builder removes the placeholder `oauth2` block and the unused `identity` permission. Calendar and Google Drive remain visibly unavailable and do not initiate authorization.

To create a Google-enabled build, pass a real Chrome-extension OAuth client ID at build time:

```bash
GOOGLE_OAUTH_CLIENT_ID=your-client.apps.googleusercontent.com npm run build
```

On PowerShell:

```powershell
$env:GOOGLE_OAUTH_CLIENT_ID = "your-client.apps.googleusercontent.com"
npm run build
```

The build fails for a malformed non-empty ID. Do not edit the generated manifest by hand.

## Known external constraints

- Large Browser Sync snapshots can exceed Chromium quotas; local JSON and Google Drive remain the supported alternatives.
- A real Google OAuth client, Google account, and network access are required for end-to-end Calendar/Drive verification.
- Chrome Web Store submission and store-side review are outside the repository.
