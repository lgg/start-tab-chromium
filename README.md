# Start Tab

Start Tab for Chromium Browsers.

Start Tab is a Manifest V3 extension for Chromium-based browsers. It combines a focused website blocker with a configurable custom new tab page.

## Current Features

- Block or unblock the current site from the browser action popup.
- Store the blocklist locally with `chrome.storage.local`.
- Edit the full blocklist from the options page.
- Enforce blocking with Manifest V3 `declarativeNetRequest` dynamic rules.
- Redirect blocked navigations to an extension-owned blocked page.
- Delay unblocking from the blocked page with a countdown.
- Track focus statistics: raw block hits, deduplicated avoided visits, estimated time saved, Pomodoro sessions, interrupted focus sessions, total focus time, and countdown unblocks.
- Localized UI with English and Russian catalogs.
- Configurable custom new tab page with date/time, IP, links, search, timer, stopwatch, Pomodoro, notes, local tasks, recent history, browser pinned tabs, Start Tab pinned links, Google Calendar, weather, command, and focus stats blocks.
- First-run layout onboarding for the custom new tab page.
- Start page appearance settings through background preset tiles with favorites, color tiles, gradient tiles, image tiles, and animated effect tiles.
- Preset themes/backgrounds for ChatGPT dark, Start Tab dark, ChatGPT light, pastel slate, pastel rose, Matrix-style, cyberpunk-style, black, aurora, mesh, spotlight, noise, and animated gradient backgrounds.
- Settings button visibility and hover-area controls for the custom new tab page.
- Link grid settings: rows, columns, icon size, font size, and horizontal or vertical paged navigation.
- Timer, stopwatch, and Pomodoro state persistence across closed and reopened new tabs.
- Optional notifications for timer and Pomodoro completion.
- Tabbed options page with General, Start Tab, Blocklist, Backup, and About sections.
- Start Tab page-content toggle inside the Start Tab options section.
- Options page with localization, backup, appearance, search, IP, Google Calendar, weather, links, timers, focus stats, and drag/drop layout controls.
- Weather settings support decimal latitude and longitude values.
- IP lookup supports provider selection plus multiple public fallback providers when the selected service is unavailable.
- Layout presets for focus, dashboard, minimal, development, and rest workflows.
- Layout editor ordering, enabling, disabling, numeric geometry editing, visual width/height resize controls, full-viewport layout zone, and block settings entry points.
- Command block actions for opening settings, exporting a backup, resetting clocks, and resetting focus statistics.
- Manual JSON export/import for all local extension data with a versioned backup schema and v1 migration path.
- Browser sync backup through chunked `chrome.storage.sync`, checksum validation, device metadata, and latest-wins smart sync.
- Google Drive backup/restore through Drive `appDataFolder` when OAuth is configured.
- Google Calendar event block when OAuth is configured.
- Weather block powered by Open-Meteo with current, daily, and weekly display modes plus configurable forecast and geocoding endpoints.
- Two build variants: full Start Tab with custom new tab override, and blocker-only without replacing the browser new tab page.
- Fallback new-tab redirect for Chromium-derived browsers that expose a browser new-tab URL but do not apply `chrome_url_overrides.newtab` normally.
- Release packaging and store permission notes in `docs/release.md`.
- Migration from the legacy `blocked` storage key to the current host-only blocklist.

## Development

```bash
npm ci
npm run typecheck
npm run build
npm run build:blocker-only
```

The full production extension is built into `build/` and can be loaded as an unpacked Chromium extension. The blocker-only variant is built into `build-blocker-only/` and omits `chrome_url_overrides.newtab` from the generated manifest.

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
8. If the diagnostic page works but Ctrl+T still opens the browser default page, the browser is not exposing a redirectable tab URL to extensions. In that case, verify the same build in Chrome or Edge to separate a Start Tab bug from a browser-level limitation.

## Google Integrations

Google Calendar and Google Drive sync require a real OAuth client ID in `src/manifest.json`:

```json
"oauth2": {
  "client_id": "REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com",
  "scopes": [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/drive.appdata"
  ]
}
```

Until the placeholder is replaced, Google-backed blocks and Drive sync show a configuration message instead of requesting auth.

## Chromium New Tab Limitation

Chromium does not provide a runtime API to toggle `chrome_url_overrides.newtab` on and off after an extension is installed. Start Tab supports this as a build-time choice:

- `npm run build` creates the full extension with the custom new tab page enabled.
- `npm run build:blocker-only` creates the blocker-only extension without replacing the browser new tab page.

Inside the full build, the Start Tab settings page can enable or disable the Start Tab page content. That setting does not remove the manifest-level new tab override from an already installed full build.

## Project Layout

- `src/manifest.json` - Chromium extension manifest.
- `src/service-worker.ts` - blocklist mutations, storage migration, DNR rule sync, fallback new-tab redirect, and block-hit tracking.
- `src/lib/blocklist.ts` - shared blocklist and redirect logic.
- `src/lib/focus-stats.ts` - focus and blocking statistics.
- `src/lib/backup.ts` - versioned manual backup export/import.
- `src/lib/chrome-sync.ts` - chunked browser sync backup and latest-wins smart sync.
- `src/lib/google-integration.ts` - Google Calendar and Drive helpers.
- `src/lib/i18n.ts` - runtime locale detection and message formatting.
- `src/popup/` - browser action popup.
- `src/blocked/` - blocked-site interstitial page.
- `src/newtab/` - custom start page.
- `src/options/` - settings page.
- `src/_locales/` - English and Russian localization catalogs.
- `docs/release.md` - release checklist and permission notes.
- `icons/` - extension icons.

## Roadmap

### Instance-Based Blocks

- Move Start Tab blocks from singleton type settings to instance-based block records.
- Allow multiple independent instances for repeatable block types: date/time in different time zones, weather for different cities, search blocks with different engines, local task lists, Google Calendar blocks with different calendar/account filters, timers, stopwatches, Pomodoro blocks, notes, and link grids.
- Keep browser-owned singleton blocks unique: recent history, browser pinned tabs, and other browser-global sources that should not be duplicated.
- Add block creation, duplication, removal, and per-instance settings from both the options page and the inline layout editor.
- Store block settings inside each block instance so export/import, browser sync, and Google Drive backup preserve every configured block independently.

### Layout Editor

- Add a full block palette with repeatable and singleton block availability rules.
- Add per-block settings panels opened from the gear icon on each block while editing the new tab page.
- Keep both layout modes: free positioning with drag/resize anywhere and grid positioning with snap-to-grid width and height.
- Keep both layout zones: contained page and full viewport, including horizontal expansion only after blocks are moved or resized beyond the default viewport.

### Themes And Backgrounds

- Promote background presets into a complete theme system covering background, text color, card surface, accent, font family, and sizing.
- Add export/import for custom themes independently from full settings backup.
- Keep all background configuration tile-based; do not expose duplicate raw background color, image URL, or effect fields outside the tile editor.
- Add richer configurable animated backgrounds where each effect exposes only relevant controls.

### Settings Coverage

- Audit every stored Start Tab setting and expose it in the options page or per-block settings where appropriate.
- Keep backup/export/import coverage aligned with every new setting and block instance schema migration.
- Add validation for numeric settings, URL settings, and provider endpoints so browser-native validation errors do not reject valid values.

## License

MIT
