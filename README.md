# Start Tab

Start Tab for Chromium Browsers.

Start Tab is a Manifest V3 extension for Chromium-based browsers. Today it works as a focused website blocker: open the popup on any HTTP or HTTPS page, add the current host to the blocklist, and future top-level navigations to that host are redirected to the extension's blocked page.

## Features

- Block or unblock the current site from the browser action popup.
- Store the blocklist locally with `chrome.storage.local`.
- Enforce blocking with Manifest V3 `declarativeNetRequest` dynamic rules.
- Redirect blocked navigations to an extension-owned blocked page.
- Delay unblocking from the blocked page with a short countdown.
- Localized UI with English and Russian catalogs.
- Language setting in the popup: Auto, English, or Russian.
- Migration from the legacy `blocked` storage key to the current host-only blocklist.

## Development

```bash
npm ci
npm run typecheck
npm run build
```

The production extension is built into `build/` and can be loaded as an unpacked Chromium extension.

## Project Layout

- `src/manifest.json` - Chromium extension manifest.
- `src/service-worker.ts` - blocklist mutations, storage migration, and DNR rule sync.
- `src/lib/blocklist.ts` - shared blocklist and redirect logic.
- `src/lib/i18n.ts` - runtime locale detection and message formatting.
- `src/popup/` - browser action popup.
- `src/blocked/` - blocked-site interstitial page.
- `src/_locales/` - English and Russian localization catalogs.
- `icons/` - extension icons.

## Roadmap

- Add a dedicated options page for richer settings management.
- Add import/export for blocklists.
- Add schedules or focus sessions for time-bounded blocking.
- Add optional new tab replacement so installing the extension can provide a configurable custom start page.
- Add configurable start page layout with movable/resizable blocks.
- Add a date/time block with display mode settings: date and time, date only, or time only, plus flexible date/time formatting.
- Add an external IP block that detects the public IP address and the country resolved from that IP.
- Add a links block with configurable rows and columns, per-link icon, URL, and title, block-level font size and font family settings, and optional paged navigation inside the block.
- Support horizontal or vertical swipe/page navigation for multi-page links blocks.
- Add a search block with a text field and configurable search provider, including Google, Yandex, Perplexity, DuckDuckGo, and other providers.
- Add timer, stopwatch, and Pomodoro blocks.
- Persist timer, stopwatch, and Pomodoro state across closed/reopened new tabs and different browser windows.
- Add optional completion notifications for timer, stopwatch, and Pomodoro blocks.
- Add visual customization settings: font family, text color, font sizes, solid background color, custom background image, and built-in animated background effects.
- Include built-in background effects such as animated gradient, soft aurora, subtle mesh gradient, slow spotlight, and calm noise texture.
- Add a settings entry button with gear icon visibility options: always visible or visible only on hover over a configured page area.
- Prepare release packaging and store submission notes.

## License

MIT
