# Manual QA checklist — Start Tab 3.0.0

This checklist is designed for a clean Chromium profile. Record browser version, operating system, extension variant, commit SHA, and pass/fail evidence for every run.

## Preparation

1. Run `npm ci`, `npm test`, and `npm run typecheck`.
2. Build the standard profiles with `npm run build` and `npm run build:blocker-only`.
3. Load `build/` as an unpacked extension in one clean profile.
4. Load `build-blocker-only/` in a separate clean profile.
5. For Google integration QA, set a real `GOOGLE_OAUTH_CLIENT_ID`, run `npm run build:google`, and load `build-google/` in a third clean profile.
6. Keep DevTools open for the service worker, popup, Options, blocked page, and new-tab page while testing.
7. Confirm there are no uncaught console errors before starting.

## Blocker

- [ ] Add the current HTTP or HTTPS site from the popup.
- [ ] Reload the site and confirm the blocked page appears.
- [ ] Confirm the original host and return target are shown correctly.
- [ ] Start the unblock countdown.
- [ ] Cancel the countdown and confirm the site remains blocked.
- [ ] Complete the countdown and confirm the site is unblocked.
- [ ] Confirm returning to the original URL works.
- [ ] Add several hosts, remove one, and confirm unrelated hosts remain blocked.
- [ ] Clear the blocklist from Options.
- [ ] Verify a blocklist at the supported 5,000-site boundary can be validated, while a 5,001-site replacement or backup import is rejected without changing the existing blocklist or DNR rules.
- [ ] Confirm focus-statistics counters update only once per event.

## Clean install and onboarding

- [ ] Open the full build new-tab page on a clean profile.
- [ ] Confirm onboarding is keyboard accessible.
- [ ] Apply each layout preset in a separate reset cycle.
- [ ] Customize a retained block, apply a preset that keeps its type, and confirm its ID, configuration, and runtime survive.
- [ ] Start a Timer, apply a preset that removes it, confirm the destructive-data warning, and verify no later background completion notification appears.
- [ ] Force or simulate a storage/alarm failure during preset save and confirm the previous layout and running clocks remain intact.
- [ ] Skip onboarding and confirm the default layout remains usable.
- [ ] Reload the page and confirm onboarding does not reappear.

## Block instances

For every repeatable type — Date & Time, IP, Links, Search, Timer, Stopwatch, Pomodoro, Note, Local Tasks, Google Calendar, Weather, and Start Tab Pinned:

- [ ] Start adding a block, cancel its configuration dialog, and confirm no block or runtime data is created.
- [ ] Add the block from the palette.
- [ ] Open its settings.
- [ ] Save valid settings.
- [ ] Cancel a second edit and confirm unsaved values are discarded.
- [ ] Add or duplicate a second instance.
- [ ] Configure different values in both instances.
- [ ] Reload and confirm values remain independent.
- [ ] Disable and re-enable one instance.
- [ ] Delete one instance and confirm the other remains unchanged.

For Commands, Recent History, Browser Pinned Tabs, and Focus Statistics:

- [ ] Confirm the palette disables a second instance.
- [ ] Delete the existing singleton.
- [ ] Confirm it becomes available in the palette.
- [ ] Add it again and reload.

## User-data protection

- [ ] Enter text in a Note block and attempt deletion.
- [ ] Add tasks to a Local Tasks block and attempt deletion.
- [ ] Confirm destructive warning text identifies the selected instance.
- [ ] Cancel and verify data remains.
- [ ] Confirm deletion and verify runtime data is removed.
- [ ] Duplicate a Note, Tasks, Links, Timer, Stopwatch, and Pomodoro block and confirm mutable state is not shared.

## Grid layout

- [ ] Enter edit mode and drag every block type.
- [ ] Resize every block type to its minimum.
- [ ] Attempt to move blocks above row 1 or before column 1.
- [ ] Attempt to resize beyond the configured grid width.
- [ ] Confirm blocks do not become inaccessible.
- [ ] Confirm placement avoids uncontrolled overlap.
- [ ] Use arrow keys to move a focused block.
- [ ] Use Shift+Arrow to resize.
- [ ] Save, reload, and confirm exact restoration.
- [ ] Cancel a separate edit session and confirm the saved layout is restored.

## Free layout

- [ ] Switch from Grid to Free and confirm no block disappears.
- [ ] Drag and resize with mouse or touch pointer input.
- [ ] Use arrow keys; verify Alt+Arrow performs fine movement.
- [ ] Attempt to drag to negative coordinates and confirm clamping.
- [ ] Move a block beyond the standard viewport and confirm horizontal expansion appears only then.
- [ ] Return all blocks inside the viewport and confirm permanent empty horizontal scrolling is absent.
- [ ] Save, reload, and confirm geometry is restored.
- [ ] Switch back to Grid and confirm the stored grid layout remains valid.

## Layout zones and viewport behavior

Test both Contained Page and Full Viewport at:

- [ ] 320 px width.
- [ ] 768 px width.
- [ ] 1440 px width.
- [ ] Ultrawide resolution.
- [ ] 125%, 150%, and 200% browser zoom.
- [ ] High-DPI display.

Also verify:

- [ ] Long notes and task titles wrap or scroll without breaking the card.
- [ ] Very small and very large cards remain controllable.
- [ ] Palette and toolbar remain reachable on narrow screens.
- [ ] No action is available only through hover.

## Timer runtime

- [ ] Start at least two Timer instances with different durations.
- [ ] Start at least two Stopwatch instances.
- [ ] Start at least two Pomodoro instances with different work/break durations.
- [ ] Enable automatic next phases, complete a break, and confirm the next work phase starts and the focus-session-start counter advances exactly once.
- [ ] Suspend the device or browser past a Pomodoro work deadline, resume it, and confirm total focus time increases only by the configured work duration rather than the suspend delay.
- [ ] Pause, reset, and use **Reset all clocks** on an already overdue Pomodoro; confirm interrupted focus time is capped at the original deadline.
- [ ] Force a focus-statistics storage failure during a Pomodoro transition and confirm clock runtime, statistics, data revision, and alarms all remain at their exact previous values.
- [ ] Close all new-tab pages and allow a timer to complete.
- [ ] Restart the service worker and confirm running clocks recover from timestamps.
- [ ] Pause, resume, and reset each type independently.
- [ ] Delete a running clock and confirm its alarm and notification are removed.
- [ ] Duplicate a stopped and a running clock; confirm the duplicate receives independent state.
- [ ] Change the operating-system clock backward and forward; confirm no negative duration or duplicate completion.
- [ ] Confirm each completion produces at most one notification.
- [ ] Export and restore a backup containing active clocks.

## Google Calendar and weather

- [ ] Build without `GOOGLE_OAUTH_CLIENT_ID`; confirm the generated manifest omits `oauth2` and `identity`, while Calendar and Drive remain disabled without opening authorization.
- [ ] With a real OAuth client, test separate Calendar blocks with different calendar IDs and filters.
- [ ] Sign out or revoke authorization and confirm localized error handling.
- [ ] Test Weather blocks for two cities.
- [ ] Test coordinate fallback with an empty city.
- [ ] Test an invalid endpoint and confirm the block shows an error without corrupting storage.

## Themes

- [ ] Select every built-in theme.
- [ ] Confirm built-in themes cannot be edited or deleted.
- [ ] Create and save a custom theme.
- [ ] Cancel creation of another custom theme and confirm no draft remains.
- [ ] Edit, duplicate, select, and delete a custom theme.
- [ ] Export a custom theme and import it again.
- [ ] Import invalid JSON and an incompatible theme file.
- [ ] Test solid, gradient, image, and every animated effect background.
- [ ] Confirm only effect-relevant controls are visible.
- [ ] Test minimum and maximum speed/intensity values.
- [ ] Enable operating-system reduced motion and confirm animations stop.
- [ ] Switch themes repeatedly and confirm no orphaned animation/listener activity.

## Backup and import

- [ ] Export a new schema-4 backup.
- [ ] Import the exported backup into a clean profile.
- [ ] Confirm instances, layout, runtime, custom themes, blocklist, locale, onboarding, and statistics are restored.
- [ ] Import a supported older backup and verify migration.
- [ ] Repeat the old-backup import and verify no duplicate instances.
- [ ] Import malformed JSON and confirm storage remains unchanged.
- [ ] Import an incompatible app/version bundle and confirm rejection.
- [ ] Force an apply failure where possible and verify pre-import rollback.
- [ ] Use the recovery action to restore the pre-import snapshot.

## Browser Sync

- [ ] Upload a snapshot from device/profile A.
- [ ] Restore it on device/profile B.
- [ ] Modify different instances and run smart sync.
- [ ] Confirm unchanged snapshots report unchanged.
- [ ] Delete an instance on A, sync, then restore on B; confirm it does not reappear.
- [ ] Simulate a missing chunk and checksum mismatch; confirm restore is rejected.
- [ ] Exceed sync quota with a large link/note dataset and confirm the UI recommends JSON or Drive instead of silently truncating.

## Google Drive

With a real OAuth client and account:

- [ ] Upload a schema-4 backup to `appDataFolder`.
- [ ] Restore it into a clean profile.
- [ ] Restore an older supported backup and confirm migration.
- [ ] Revoke OAuth and confirm a clear error.
- [ ] Confirm no OAuth flow starts in a default build that has no `oauth2` manifest block.

## Accessibility

- [ ] Navigate Options, onboarding, palette, card controls, and dialogs using only the keyboard.
- [ ] Confirm visible focus indicators.
- [ ] Confirm icon buttons expose accessible names.
- [ ] Close dialogs with Escape.
- [ ] Confirm cancellation prompts when unsaved values exist.
- [ ] Confirm focus returns to a sensible control after dialog close.
- [ ] Inspect dialog semantics with the browser accessibility tree.
- [ ] Check text contrast for every built-in theme.
- [ ] Confirm touch targets remain usable on a narrow viewport.

## Build variants

### Full

- [ ] `build/manifest.json` contains `chrome_url_overrides.newtab`.
- [ ] New-tab page, popup, Options, blocked page, and service worker load without console errors.

### Blocker-only

- [ ] `build-blocker-only/manifest.json` does not contain `chrome_url_overrides`.
- [ ] New-tab entry files are absent from the package.
- [ ] Browser native new tab remains unchanged.
- [ ] In the Split View picker, confirm privileged/internal tabs (`chrome:`, `edge:`, extension pages, files, and script URLs) are not offered as navigation targets.
- [ ] Popup, Options, blocker, backup, and statistics remain functional.

### Google-enabled full

- [ ] `build-google/manifest.json` contains the supplied OAuth client ID and `identity` permission.
- [ ] The build still contains `chrome_url_overrides.newtab` and all full Start Tab assets.
- [ ] A malformed non-empty OAuth client ID fails the build.

## Result recording

For each failed item capture:

- Commit SHA and extension variant.
- Browser and operating-system version.
- Exact steps.
- Expected and actual result.
- Console/service-worker logs.
- Screenshot or short recording.
- Whether the issue reproduces after a clean profile reset.

## Round 16 targeted interactive checks

- [ ] Start multiple Timer/Pomodoro instances, use **Reset all clocks**, and confirm every configured clock resets together with no delayed completion notification from the previous alarms.
- [ ] In a Chromium-derived browser that rejects all native-new-tab URLs, use the native-tab escape and confirm the temporary `about:blank` tab and bypass marker are cleaned up after the visible error.

## Round 18 collection-capacity checks

- [ ] Confirm the Layout Editor and Options stop offering new or duplicate blocks at the supported 1,000-instance boundary and display a clear capacity message.
- [ ] Import a backup with 1,001 blocks and confirm it is rejected without changing current settings, runtime, DNR rules, or alarms.
- [ ] Import a backup with 1,001 custom themes and confirm it is rejected before any storage mutation.
- [ ] Import a backup containing 10,001 tasks in one Local Tasks instance and confirm it is rejected instead of creating a task list that cannot later be edited.
- [ ] Confirm backups exactly at 1,000 blocks, 1,000 custom themes, and 10,000 tasks remain valid.


## Round 19 prototype-safety and recovery checks

- [ ] Import a valid schema-4 fixture whose block IDs include `__proto__`, `constructor`, `toString`, and `hasOwnProperty`; confirm notes, tasks, clocks, and link-page positions remain independent and editable after reload.
- [ ] Import focus-stat/domain fixtures using the same special names and confirm values remain visible without unrelated settings or browser-page behavior changing.
- [ ] Seed local storage above the supported block/task/blocklist capacities, then export; confirm export succeeds with a bounded recoverable snapshot instead of becoming unavailable.
- [ ] From the same oversized local state, import a valid backup and confirm the valid backup applies while the pre-import recovery snapshot is retained at supported limits.
- [ ] Import an externally supplied backup above any supported capacity and confirm rejection still happens before storage, DNR, revision, or alarm changes.

## Round 36 regression checks

- [ ] Select a preset from free layout and confirm Options switches the visible mode to Grid, restores the preset column count, and the saved layout visibly matches the preset.
- [ ] After applying a preset, manually change mode or columns and confirm the preset selector/profile becomes Custom rather than retaining stale preset metadata.
- [ ] Use the ordinary Open Start Tab action from Options and confirm it does not show the Split View picker merely because an opener tab exists.
- [ ] Set an explicit Russian locale, disable Start Tab or open a real Split View context, and confirm the early gate appears in Russian before the module UI initializes.
- [ ] In onboarding and the disabled/Split View gate, confirm keyboard focus remains inside the active dialog, the page behind it is inert, and removing one overlay does not unlock the page while another modal remains.
- [ ] Delay the early gate decision and confirm onboarding never stacks over the disabled or Split View overlay.
- [ ] Confirm every direct restore/import action asks for confirmation before replacing local data; cancel and verify storage remains unchanged.
- [ ] Simulate Browser Sync metadata/chunk interleaving after upload and confirm the upload fails without advancing local sync metadata.
- [ ] Force statistics loading to fail and confirm all Options navigation links and non-statistics sections remain usable, with a localized statistics fallback.
