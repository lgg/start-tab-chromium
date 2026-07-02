# Release Notes

## Build

```bash
npm ci
npm run typecheck
npm run build
```

Load `build/` as an unpacked Chromium extension for manual QA.

## Manual QA Checklist

- Popup can block, unblock, and clear the blocklist.
- Blocked page shows a countdown and returns to the last blocked URL after unblock.
- Focus stats update after blocked navigations and countdown unblocks.
- New tab renders enabled blocks without console errors.
- Timer, stopwatch, and Pomodoro state survives closing and reopening a new tab.
- Options page saves appearance, links, weather, calendar, timers, stats, and layout settings.
- JSON export/import restores blocklist, settings, runtime state, locale, and stats.
- Browser sync backup restore works when Chromium sync storage is available.
- Google Calendar and Google Drive flows show a clear configuration message until OAuth client ID is configured.
- After OAuth client ID is configured, Google Calendar events load and Drive backup/restore works.

## Store Notes

- Permission rationale:
  - `storage`: blocklist, settings, timer state, backups, and stats.
  - `declarativeNetRequest`: enforce site blocking in Manifest V3.
  - `webNavigation`: record blocked navigation metadata and focus stats.
  - `tabs`: show and reload the active tab from the popup, read pinned tabs for the start page.
  - `history`: render the recent history block when enabled.
  - `notifications`: timer and Pomodoro completion notifications.
  - `identity`: optional Google Calendar and Google Drive integrations.
  - `<all_urls>`: block selected sites and call configured public IP/weather endpoints.
- Google OAuth is optional. The extension must ship with a real Chrome extension OAuth client ID before Google-backed features can be used.
- Chromium new tab override is static. A blocker-only release should be shipped as a separate build without `chrome_url_overrides.newtab`.
