# Storage and settings inventory

This document classifies the extension's persisted data for schema 4/runtime schema 2.

| Storage key / domain | Scope | Runtime | Full backup | Browser Sync | Google Drive | User UI | Validation / migration |
|---|---|---:|---:|---:|---:|---:|---|
| `startPageSettings.startTab.enabled` | Global | No | Yes | Yes | Yes | General Options | Boolean default and schema migration |
| `startPageSettings.settingsButton` | Global | No | Yes | Yes | Yes | General Options | Enum validation |
| `startPageSettings.focusStats` | Global defaults | No | Yes | Yes | Yes | General Options | Numeric min/max validation |
| `startPageSettings.layout.mode` | Global layout | No | Yes | Yes | Yes | Options and inline editor | Grid/free enum migration |
| `startPageSettings.layout.zone` | Global layout | No | Yes | Yes | Yes | Options and inline editor | Contained/full enum migration |
| `startPageSettings.layout.columns` | Global layout | No | Yes | Yes | Yes | General Options | Integer clamp |
| `startPageSettings.layout.rowHeight` | Global layout | No | Yes | Yes | Yes | General Options | Numeric clamp |
| `startPageSettings.layout.gap` | Global layout | No | Yes | Yes | Yes | General Options | Numeric clamp |
| `startPageSettings.layout.containedMaxWidth` | Global layout | No | Yes | Yes | Yes | General Options | Numeric clamp |
| `startPageSettings.layout.showBlockTitles` | Global layout | No | Yes | Yes | Yes | General Options | Boolean default |
| `startPageSettings.layout.profile` | Global layout | No | Yes | Yes | Yes | Preset selector | Known preset/custom normalization |
| `startPageSettings.layout.blocks[]` identity, enabled, zone, order | Per instance | No | Yes | Yes | Yes | Palette, inline editor, Options | Stable unique IDs, singleton constraints, version migration |
| `layout.blocks[].column/row/width/height` | Per instance grid geometry | No | Yes | Yes | Yes | Inline editor | Coordinate and minimum-size normalization |
| `layout.blocks[].free` | Per instance free geometry | No | Yes | Yes | Yes | Inline editor | Finite non-negative values and minimum sizes |
| Date & Time config | Per instance | No | Yes | Yes | Yes | Shared instance editor | Mode, IANA timezone, locale, font-size validation |
| IP endpoint | Per instance | No | Yes | Yes | Yes | Shared instance editor | HTTP(S) URL validation |
| Link-grid config and items | Per instance | No | Yes | Yes | Yes | Shared instance editor | Rows, columns, font/icon sizes, title and URL validation |
| Search config and providers | Per instance | No | Yes | Yes | Yes | Shared instance editor | Unique IDs, title, HTTP(S) template containing `{query}` |
| Timer config | Per instance | No | Yes | Yes | Yes | Shared instance editor | Duration and notification validation |
| Stopwatch config | Per instance | No | Yes | Yes | Yes | Shared instance editor | Discriminated empty config |
| Pomodoro config | Per instance | No | Yes | Yes | Yes | Shared instance editor | Work/break duration and flags |
| Note config | Per instance | No | Yes | Yes | Yes | Shared instance editor | Placeholder and delete-confirmation flag |
| Local Tasks config | Per instance | No | Yes | Yes | Yes | Shared instance editor | Placeholder and display flags |
| Google Calendar config | Per instance | No | Yes | Yes | Yes | Shared instance editor | Calendar ID, label, filter, result limit |
| Weather config | Per instance | No | Yes | Yes | Yes | Shared instance editor | Latitude, longitude, endpoint, city, display enum |
| Recent History limit | Singleton instance | No | Yes | Yes | Yes | Shared instance editor | Integer clamp |
| `startPageSettings.themes.selectedThemeId` | Global | No | Yes | Yes | Yes | Themes Options | Must resolve to built-in or custom theme |
| `startPageSettings.themes.customThemes[]` | Per custom theme | No | Yes | Yes | Yes | Theme editor/import/export | Versioned theme and background-tile validation |
| `startPageRuntimeState.clocks` | Per clock instance | Yes | Yes | Yes | Yes | Clock controls | Runtime schema migration, timestamp normalization, completion tokens |
| `startPageRuntimeState.notes` | Per Note instance | Yes | Yes | Yes | Yes | Note block | String length normalization |
| `startPageRuntimeState.tasks` | Per Local Tasks instance | Yes | Yes | Yes | Yes | Task block | Task ID/title/timestamp normalization |
| `startPageRuntimeState.linkPages` | Per link instance | Yes | Yes | Yes | Yes | Pager controls | Non-negative integer normalization |
| `blockedSites` | Global blocker | Operational | Yes | Yes | Yes | Popup and Options | Host normalization and duplicate removal |
| `lastBlockedUrls` | Per host navigation recovery | Operational | Yes | Yes | Yes | Internal blocked-page flow | URL/host normalization |
| `focusStats` | Global statistics | Runtime aggregate | Yes | Yes | Yes | Statistics section | Versioned counters and timestamp normalization |
| `localeOverride` | Global | No | Yes | Yes | Yes | General Options and popup | `auto`, `en`, or `ru` |
| `startPageOnboarding` | Global UI state | No | Yes | Yes | Yes | Onboarding actions | Boolean/version normalization |
| `startTabSyncMeta`, chunks, device ID | Internal sync metadata | Internal | No | Stored by sync | No | Sync status/actions only | Checksum, chunk-count, timestamp, and version validation |
| `startTabDataRevision` | Internal conflict marker | Internal | No | Local sync logic | No | Hidden | Finite timestamp normalization |
| pre-import recovery backup | Internal recovery | Internal | No recursive backup | No | No | Recovery action | Full backup validation before restore |
| migration report | Internal diagnostic | Internal | Optional diagnostic | No | No | Statistics/migration section | Typed issue normalization |

## Deliberately hidden technical values

The following are not exposed as editable fields because changing them manually could corrupt persistence or security behavior:

- Schema and runtime version numbers.
- Generated instance and theme IDs.
- Sync device, snapshot, checksum, and chunk metadata.
- Alarm names and clock completion tokens.
- Pre-import recovery payload.
- Migration report internals.
- Built-in theme definitions.
- OAuth access tokens managed by `chrome.identity`.

## Revision and conflict behavior

Settings and instance runtime writes update the local data-revision marker. Browser Sync also compares a canonical content checksum, so a changed snapshot is detected even when two exports have different transport timestamps. Restore writes the remote content timestamp and local sync metadata together so the same snapshot is not immediately treated as a new local edit.

## Backup exclusions

Transient UI state, open dialogs, pointer-drag sessions, DOM state, intervals, event listeners, and generated build artifacts are not persisted or backed up.
