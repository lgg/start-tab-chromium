# Release Notes — Start Tab 3.0.0

## Release Scope

Start Tab 3.0.0 completes the instance-based Start Tab roadmap and preserves the blocker-only product variant.

Key release areas:

- Typed block instances with stable IDs and discriminated per-block configuration.
- Independent repeatable Date/Time, IP, Links, Search, Timer, Stopwatch, Pomodoro, Note, Local Tasks, Google Calendar, Weather, and Start Tab Pinned blocks.
- Singleton enforcement for Commands, Recent History, Browser Pinned Tabs, and Focus Statistics.
- Visual Layout Editor with palette, drag/resize, keyboard support, Grid/Free modes, and Contained/Full zones.
- Versioned theme system with immutable built-ins, custom theme CRUD, standalone theme import/export, tile-based backgrounds, and reduced-motion-aware effects.
- Start Page schema 4, runtime schema 2, backup schema 4, and automatic idempotent migration from legacy singleton data.
- Recoverable JSON import, chunked Browser Sync, and Google Drive `appDataFolder` backup/restore migration.
- English/Russian localization parity and centralized validation.
- Full, blocker-only, and optional Google-enabled production profiles.

## Required Automated Checks

```bash
npm ci --no-audit --no-fund --loglevel=error
npm test
npm run typecheck
npm run build
npm run build:blocker-only
```

The CI workflow additionally validates a Google-enabled build with a syntactically valid non-production OAuth client ID.

## Build Profiles

### Full Start Tab

```bash
npm run build
```

Output: `build/`

- Contains `chrome_url_overrides.newtab`.
- Contains the new-tab page and all Start Tab features.
- Always omits `oauth2` and `identity`; an inherited `GOOGLE_OAUTH_CLIENT_ID` does not change this profile.

### Blocker-only

```bash
npm run build:blocker-only
```

Output: `build-blocker-only/`

- Omits `chrome_url_overrides` and all new-tab assets.
- Omits the unused `history` permission.
- Retains popup, blocked page, Options, blocker, backup, and focus statistics.
- Its Options page does not offer the unavailable Open Start Tab action and disables the ineffective Start Tab runtime toggle.
- Ignores inherited Google OAuth environment values and omits `oauth2` and `identity`.

### Google-enabled Full Start Tab

The explicit Google profile is the only build profile that reads `GOOGLE_OAUTH_CLIENT_ID`. Create a Chrome extension OAuth client for the final extension ID and replace the entire placeholder below with that real client ID:

```bash
GOOGLE_OAUTH_CLIENT_ID="REPLACE_WITH_REAL_CLIENT_ID.apps.googleusercontent.com" npm run build:google
```

PowerShell:

```powershell
$env:GOOGLE_OAUTH_CLIENT_ID = "REPLACE_WITH_REAL_CLIENT_ID.apps.googleusercontent.com"
npm run build:google
```

The shown placeholder is intentionally rejected.

Output: `build-google/`

- Contains the full Start Tab new-tab override.
- Contains the supplied OAuth client ID, Calendar/Drive scopes, and `identity` permission.
- Rejects missing, placeholder, or malformed client IDs.
- Cannot be combined with blocker-only packaging.
- Must be tested with the production OAuth client and a real account before release.

Do not edit generated manifests by hand.

## Migration Notes

- Start Page settings move from legacy singleton/global settings into typed `layout.blocks` instances.
- Each instance preserves enabled state, Grid and Free geometry, zone, order, valid block settings, and user data where applicable.
- Notes, tasks, link-page positions, Timer, Stopwatch, and Pomodoro state are keyed by instance ID.
- Migration is idempotent and does not create duplicate instances on repeated startup.
- Unknown or damaged elements are isolated where possible so valid sibling data survives.
- Unsupported future schemas are not silently downgraded.
- Legacy runtime data is removed only after the new structure is persisted successfully.
- Backup import validates and migrates before applying, stores a recovery snapshot, and rolls back storage/DNR state on failure.

## Manual QA

Execute and record the complete checklist in `docs/manual-qa-3.0.0.md`.

Minimum release gates:

- Popup block, unblock, clear, and blocked countdown flows.
- Focus-stat updates without duplicate events.
- Clean install, onboarding preset, and onboarding skip.
- Creation and independence of every repeatable block type.
- Singleton restriction, deletion, and palette recovery.
- Per-instance settings save/cancel from Options and inline editing.
- Grid/Free drag, resize, keyboard control, persistence, and cancellation.
- Contained/Full zones across narrow, normal, ultrawide, zoomed, and high-DPI viewports.
- Multiple concurrent Timer, Stopwatch, and Pomodoro instances through page/service-worker restarts.
- Built-in and custom theme lifecycle, standalone import/export, effects, and reduced motion.
- New and legacy backup import, malformed import rejection, and recovery rollback.
- Browser Sync upload/restore/conflict/deletion/checksum/quota behavior on real profiles.
- Google Calendar and Drive with a real client/account, including revoked authorization.
- Full, blocker-only, and Google-enabled generated manifests and console-error checks.
- Keyboard navigation, dialog semantics, focus return, contrast, and touch targets.

## Store Permission Rationale

- `storage`: blocklist, instance settings, per-instance runtime, themes, backups, sync metadata, onboarding, locale, and statistics.
- `unlimitedStorage`: local user notes, tasks, links, themes, and backup data without small local quota failures.
- `alarms`: durable Timer and Pomodoro completion across Manifest V3 service-worker suspension.
- `notifications`: optional Timer and Pomodoro completion notifications.
- `declarativeNetRequest`: enforce the configured website blocklist.
- `webNavigation`: capture blocked navigation metadata and focus statistics.
- `tabs`: inspect/reload the active tab, render browser pinned tabs, and handle native-new-tab fallback behavior.
- `history`: render the Recent History block in full Start Tab builds only.
- `identity`: included only in Google-enabled builds for Calendar and Drive authorization.
- `<all_urls>`: block configured sites and call configured public IP/weather endpoints.

Do not add permissions without an implemented feature and an updated rationale.

## External Validation Boundary

Repository checks cannot prove:

- Chrome Web Store review or policy acceptance.
- Real Google OAuth consent, revocation, Calendar, or Drive behavior for the production extension ID.
- Real multi-device `chrome.storage.sync` propagation and quota behavior.
- Browser-specific native-new-tab behavior across every Chromium-derived browser.
- Physical pointer, touch, zoom, high-DPI, and accessibility behavior on every target device.

These are release-environment checks, not reasons to report repository-internal automated validation as failed or skipped.
