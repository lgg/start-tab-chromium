# Release Notes

## Build

```bash
npm ci
npm run typecheck
npm run build
npm run build:blocker-only
```

Load `build/` as the full Start Tab extension with the custom new tab page enabled. Load `build-blocker-only/` when the blocker should not replace the browser new tab page.

## Manual QA Checklist

- Popup can block, unblock, and clear the blocklist.
- Blocked page shows a countdown and returns to the last blocked URL after unblock.
- Focus stats update after blocked navigations and countdown unblocks.
- Full build new tab renders enabled blocks without console errors.
- Full build first-run onboarding can apply a layout preset or be skipped.
- Blocker-only build manifest does not contain `chrome_url_overrides.newtab`.
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
- Chromium new tab override is static. Ship the blocker-only build when Start Tab should not replace the browser new tab page.
