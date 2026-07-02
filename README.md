# Start Tab

Start Tab for Chromium Browsers.

Start Tab is a Manifest V3 extension for Chromium-based browsers. It combines a focused website blocker with a configurable custom new tab page.

## Current Features

- Block or unblock the current site from the browser action popup.
- Store the blocklist locally with `chrome.storage.local`.
- Enforce blocking with Manifest V3 `declarativeNetRequest` dynamic rules.
- Redirect blocked navigations to an extension-owned blocked page.
- Delay unblocking from the blocked page with a countdown.
- Track focus statistics: raw block hits, deduplicated avoided visits, estimated time saved, Pomodoro sessions, interrupted focus sessions, and countdown unblocks.
- Localized UI with English and Russian catalogs.
- Configurable custom new tab page with date/time, IP, links, search, timer, stopwatch, Pomodoro, notes, local tasks, recent history, browser pinned tabs, Start Tab pinned links, Google Calendar, weather, command, and focus stats blocks.
- First-run layout onboarding for the custom new tab page.
- Start page appearance settings: font, text color, background color, background image, and built-in background effects.
- Link grid settings: rows, columns, icon size, font size, and horizontal or vertical paged navigation.
- Timer, stopwatch, and Pomodoro state persistence across closed and reopened new tabs.
- Optional notifications for timer and Pomodoro completion.
- Options page with localization, backup, appearance, search, IP, Google Calendar, weather, links, timers, focus stats, and drag/drop layout controls.
- Manual JSON export/import for all local extension data.
- Browser sync backup through chunked `chrome.storage.sync`.
- Google Drive backup/restore through Drive `appDataFolder` when OAuth is configured.
- Google Calendar event block when OAuth is configured.
- Weather block powered by Open-Meteo with current, daily, and weekly display modes.
- Two build variants: full Start Tab with custom new tab override, and blocker-only without replacing the browser new tab page.
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

Inside the full build, the start page itself is configurable through settings.

## Project Layout

- `src/manifest.json` - Chromium extension manifest.
- `src/service-worker.ts` - blocklist mutations, storage migration, DNR rule sync, and block-hit tracking.
- `src/lib/blocklist.ts` - shared blocklist and redirect logic.
- `src/lib/focus-stats.ts` - focus and blocking statistics.
- `src/lib/backup.ts` - versioned manual backup export/import.
- `src/lib/chrome-sync.ts` - chunked browser sync backup.
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

- Add schema migrations for future backup versions beyond v1.
- Add sync conflict handling for settings changed on multiple devices, including latest-wins MVP and later per-section merge.
- Add richer layout presets, such as rest, development, and minimal variants per workflow.
- Add visual resize handles to the layout editor; the current editor supports ordering, enabling, disabling, and numeric geometry edits.
- Add richer command palette actions.

## License

MIT
