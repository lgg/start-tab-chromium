# Start Tab 3.0.0 deployment

## Requirements

- Node.js 22
- npm
- Chromium 120 or newer

## Validated build profiles

### Full Start Tab without Google OAuth

```bash
npm ci --no-audit --no-fund --loglevel=error
npm test
npm run typecheck
npm run build
```

Load or package the generated `build/` directory. This profile owns the browser new-tab page and intentionally omits Google OAuth configuration and the `identity` permission. The profile is deterministic: an inherited `GOOGLE_OAUTH_CLIENT_ID` value is ignored unless `npm run build:google` selects the explicit Google profile.

### Blocker-only

```bash
npm ci --no-audit --no-fund --loglevel=error
npm test
npm run typecheck
npm run build:blocker-only
```

Load or package `build-blocker-only/`. It has no `chrome_url_overrides`, no new-tab assets, and no `history` permission. Its Options page detects that profile, does not offer the unavailable Open Start Tab action, and keeps the Start Tab runtime toggle disabled while preserving latent settings for a later full build.

### Full Start Tab with Google Calendar and Drive

Create a Chrome extension OAuth client in Google Cloud for the final extension ID, then build with that exact client ID:

```bash
GOOGLE_OAUTH_CLIENT_ID="1234567890-example.apps.googleusercontent.com" npm run build:google
```

PowerShell:

```powershell
$env:GOOGLE_OAUTH_CLIENT_ID = "1234567890-example.apps.googleusercontent.com"
npm run build:google
```

Load or package `build-google/`. The explicit Google profile validates the client ID, injects the least-privilege Calendar/Drive scopes, and enables `identity`. Placeholder or malformed IDs fail the build, and Google mode cannot be combined with blocker-only packaging.

## Pre-deployment checks

- Install the chosen unpacked build in a clean Chromium profile.
- Confirm Start Tab ownership only for the full profiles.
- Confirm blocker-only leaves the native new tab unchanged.
- Test block, unblock, clear, browser restart, backup export/import, reset, timers, notifications, locale switching, and layout editing.
- For Google builds, test authorization, token revocation, Calendar, Drive upload, and Drive restore with a real account.
- For Chrome Sync, test two real browser profiles/devices before publishing.

## Known external validation boundary

Automated local tests cover storage transactions, rollback, conflicts, generated manifests, and build structure. Real Google authorization, real multi-device Chrome Sync, and browser-specific native-new-tab behavior still require interactive tests in the deployment environment.
