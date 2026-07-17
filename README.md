# Start Tab

Start Tab for Chromium Browsers.

Start Tab is a Manifest V3 extension for Chromium-based browsers. It combines a focused website blocker with a configurable custom new tab page.

## Current Features

- Block or unblock the current site from the browser action popup.
- Store the blocklist locally with `chrome.storage.local`.
- Edit the full blocklist from the options page, with an explicit 5,000-site Chrome DNR redirect-rule capacity guard.
- Enforce blocking with Manifest V3 `declarativeNetRequest` dynamic rules.
- Redirect blocked navigations to an extension-owned blocked page.
- Delay unblocking from the blocked page with a countdown.
- Track focus statistics: raw block hits, deduplicated avoided visits, estimated time saved, Pomodoro sessions, interrupted focus sessions, total focus time, and countdown unblocks.
- Localized UI with English and Russian catalogs.
- Configurable custom new tab page with date/time, IP, links, search, timer, stopwatch, Pomodoro, notes, local tasks, recent history, browser pinned tabs, Start Tab pinned links, Google Calendar, weather, command, and focus stats blocks.
- Typed instance-based block records with stable IDs, versioned schemas, independent settings, and per-instance runtime state.
- Multiple independent instances for repeatable blocks, including date/time, IP, links, search, timers, stopwatches, Pomodoro, notes, local tasks, Google Calendar, weather, and Start Tab pinned links.
- Singleton enforcement for browser-global blocks such as commands, recent history, browser pinned tabs, and focus statistics.
- Block creation, duplication, deletion, enable/disable controls, destructive-action protection, and shared per-instance settings from both Options and the inline editor.
- First-run layout onboarding and presets for focus, dashboard, minimal, development, and rest workflows.
- Complete visual Layout Editor with a localized block palette, keyboard controls, drag/resize, Grid and Free modes, and Contained Page and Full Viewport zones.
- Horizontal expansion only when Free-mode content actually extends beyond the standard viewport.
- Versioned theme system covering tile-based backgrounds, text, card surfaces, borders, opacity, shadows, accents, interaction states, typography, radius, and spacing.
- Built-in ChatGPT dark, Start Tab dark, ChatGPT light, pastel slate, pastel rose, Matrix-style, cyberpunk-style, black, aurora, mesh, spotlight, noise, and animated-gradient themes.
- Custom theme create, edit, duplicate, delete, standalone import, and standalone export flows.
- Animated backgrounds with effect-specific controls and `prefers-reduced-motion` handling.
- Settings button visibility and hover-area controls.
- Link grid rows, columns, icon size, font size, and horizontal or vertical paged navigation.
- Independent Timer, Stopwatch, and Pomodoro state persistence across new tabs and service-worker restarts, with durable alarms and optional completion notifications.
- Tabbed options page with General, Start Tab, Blocklist, Backup, and About sections.
- Centralized validation for numeric settings, URLs, coordinates, provider endpoints, search templates, clocks, themes, and imported data.
- Versioned JSON export/import with legacy migration, pre-import recovery, rollback, and corrupted-element isolation.
- Browser backup through chunked `chrome.storage.sync`, checksum validation, device metadata, deterministic conflict handling, and latest-wins smart sync.
- Google Drive backup/restore through Drive `appDataFolder` when OAuth is configured.
- Google Calendar event blocks with independent calendar IDs and filters when OAuth is configured.
- Weather blocks powered by Open-Meteo with current, daily, and weekly display modes plus configurable forecast and geocoding endpoints.
- IP lookup provider selection with public fallbacks.
- Two build variants: full Start Tab with custom new tab override, and blocker-only without replacing the browser new tab page.
- Optional Google-enabled full build with build-time OAuth client injection.
- Fallback new-tab redirect for Chromium-derived browsers that expose a browser new-tab URL but do not apply `chrome_url_overrides.newtab` normally.
- Migration from legacy singleton Start Tab settings/runtime and the legacy `blocked` storage key.

## Development

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run build:blocker-only
```

The full production extension is built into `build/` and can be loaded as an unpacked Chromium extension. The blocker-only variant is built into `build-blocker-only/` and omits `chrome_url_overrides.newtab`, new-tab assets, and the unused `history` permission.

### Google-enabled build

Create a Chrome extension OAuth client for the final extension ID, then inject it at build time:

```bash
GOOGLE_OAUTH_CLIENT_ID="1234567890-example.apps.googleusercontent.com" npm run build:google
```

PowerShell:

```powershell
$env:GOOGLE_OAUTH_CLIENT_ID = "1234567890-example.apps.googleusercontent.com"
npm run build:google
```

The Google-enabled artifact is written to `build-google/`. The builder validates the ID and includes the Calendar/Drive OAuth configuration plus the `identity` permission. Default full and blocker-only builds deliberately omit both OAuth configuration and `identity`. Placeholder or malformed IDs fail validation instead of producing an ambiguous package.

## Local Install And New Tab Checks

1. Build the full extension with `npm run build`.
2. In the browser extensions page, remove the old unpacked extension if it points to a stale folder.
3. Load the `build/` folder, not `build-blocker-only/`.
4. Open `build/manifest.json` and verify it contains:

```json
"chrome_url_overrides": {
  "newtab": "newtab.html"
}
```

5. Open extension Options -> About -> Open Start Tab. If this opens the Start Tab page, the extension page itself is working.
6. Open Options -> Start Tab and keep Enable Start Tab page content checked.
7. Open a new tab. In Chrome, the manifest override should own it directly. In browsers such as Comet, the service worker also tries a fallback redirect when the browser exposes an internal new-tab URL such as `chrome://newtab`, `chrome://new-tab-page`, `chrome-search://local-ntp`, or a Comet-specific new-tab URL.
8. If the diagnostic page works but Ctrl+T still opens the browser default page, the browser is not exposing a redirectable tab URL to extensions. Verify the same build in Chrome or Edge to separate a Start Tab defect from a browser-level limitation.

## Google Integrations

Google Calendar and Google Drive require the Google-enabled build described above. Do not edit the generated manifest manually.

Without `GOOGLE_OAUTH_CLIENT_ID`, the builder removes the source manifest placeholder and the `identity` permission. Google-backed blocks and Drive actions show a configuration message and do not start a meaningless authorization request.

Real end-to-end Calendar and Drive validation requires a production OAuth client associated with the final packaged extension ID and a real Google account.

## Chromium New Tab Limitation

Chromium does not provide a runtime API to toggle `chrome_url_overrides.newtab` on and off after an extension is installed. Start Tab supports this as a build-time choice:

- `npm run build` creates the full extension with the custom new tab page enabled.
- `npm run build:blocker-only` creates the blocker-only extension without replacing the browser new tab page.

Inside the full build, the Start Tab settings page can enable or disable the Start Tab page content. That setting does not remove the manifest-level new tab override from an already installed full build.

## Data Architecture And Migration

- Start Page settings schema: version 4.
- Per-instance runtime schema: version 2.
- Full backup schema: version 4.
- Theme schema: version 1.
- Every block instance stores a stable ID, type, enabled state, zone, Grid and Free geometry, order, typed configuration, and timestamps.
- Mutable notes, tasks, link-page positions, timers, stopwatches, and Pomodoro state are stored by instance ID.
- Legacy singleton/global settings are migrated idempotently into block instances.
- Unknown or damaged elements are isolated where possible instead of resetting unrelated valid data.
- Unsupported future schemas are not silently downgraded or overwritten.
- Backup import validates and migrates before applying, preserves a recovery snapshot, and restores the previous state if application or DNR synchronization fails.

## Project Layout

- `src/manifest.json` - Chromium extension source manifest; the builder strips or injects optional OAuth configuration.
- `src/service-worker.ts` - blocklist/DNR transactions, storage migration, durable clock ownership, fallback new-tab redirect, and focus tracking.
- `src/lib/start-page-types.ts` - typed block, layout, theme, and runtime schemas.
- `src/lib/start-page-defaults.ts` - registry, defaults, presets, and built-in themes.
- `src/lib/start-page-validation.ts` - centralized schema and setting validation.
- `src/lib/start-page-settings.ts` - migration and persistence for instance-based settings.
- `src/lib/start-page-runtime.ts` - per-instance runtime persistence.
- `src/lib/backup.ts` - versioned manual backup export/import and recovery.
- `src/lib/chrome-sync.ts` - chunked browser sync backup and deterministic conflict handling.
- `src/lib/google-integration.ts` - Google Calendar and Drive helpers.
- `src/lib/i18n.ts` - runtime locale detection and message formatting.
- `src/newtab/` - custom start page, block renderers, theme runtime, and Layout Editor.
- `src/options/` - settings, block-instance management, themes, backup, and integrations.
- `src/popup/` - browser action popup.
- `src/blocked/` - blocked-site interstitial page.
- `src/_locales/` - English and Russian localization catalogs.
- `scripts/roadmap-fixtures.ts` - executable roadmap migration/runtime fixtures.
- `scripts/validate-static.mjs` - architecture, localization, security, and production-graph validation.
- `docs/manual-qa-3.0.0.md` - reproducible interactive QA checklist.
- `docs/deployment-3.0.0.md` - deployable build profiles and external validation boundary.
- `docs/release.md` - release checklist and permission rationale.

## Roadmap Status — Completed In 3.0.0

The former Instance-Based Blocks, Layout Editor, Themes and Backgrounds, and Settings Coverage roadmap is implemented in the current production architecture.

- [x] Typed instance-based blocks and singleton constraints.
- [x] Independent repeatable block configuration and runtime state.
- [x] Automatic idempotent migration from legacy singleton data.
- [x] Full palette-based Layout Editor with Grid/Free modes and Contained/Full zones.
- [x] Shared per-instance settings in Options and the inline editor.
- [x] Complete tile-based theme system and custom theme import/export.
- [x] Central validation and settings coverage inventory.
- [x] Versioned backup/import, Browser Sync, and Google Drive restore migration.
- [x] English/Russian localization parity.
- [x] Full, blocker-only, and optional Google-enabled build validation.
- [x] Automated migration/runtime/static fixtures and reproducible manual QA documentation.
- [x] Multiple completed independent post-roadmap audit rounds with production hardening.

Future work should be added as concrete new issues or a new roadmap section rather than leaving these completed 3.0.0 features marked as pending.

## License

MIT
