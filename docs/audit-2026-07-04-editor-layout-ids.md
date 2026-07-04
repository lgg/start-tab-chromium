# Full Project Audit - Editor Layout IDs

Date: 2026-07-04
Branch: `codex/full-project-audit-editor-layout-ids-20260704`
Base: `master`

## Scope

This audit pass reviewed the full extension with focus on direct runtime writes and layout identity consistency:

- MV3 service worker, popup messaging, blocklist/DNR flow, and blocked page redirect handling;
- new-tab runtime, gate overlay, IP/weather/calendar/search/history/pinned/stat blocks;
- layout editor runtime, free/grid layout persistence, card-to-block mapping, and storage change handling;
- options UI, JSON settings editing, backup/import/export, Chrome Sync, and Google Drive restore;
- timers, stopwatch, pomodoro, local tasks, focus stats, and runtime state preservation;
- i18n EN/RU and fallback text paths;
- manifest permissions, CI/build/typecheck, and artifact/cache retention;
- performance risks around MutationObserver, interval startup, repeated fetches, and repeated storage writes;
- security/error handling and user setting preservation.

## Finding

The TypeScript settings path now normalizes layout block IDs, but `src/newtab/editor.js` still reads and writes `startPageSettings` directly through its own local `normalizeSettings()` helper. That helper copied `layout.blocks` as-is.

If malformed settings with duplicate or empty `layout.blocks[].id` reached the layout editor, editor actions such as drag, resize, show/hide, and block settings focus could persist the malformed IDs again. Since cards are mapped by `data-block-id`, duplicate IDs can make the editor update or focus the wrong block.

## Fix

- Added local layout block ID normalization to `src/newtab/editor.js`.
- Empty IDs now fall back to the block type.
- Duplicate IDs get stable numeric suffixes during normalization.
- Existing valid IDs remain unchanged.

## Safety Notes

This does not change the storage schema or remove any user blocks. It only repairs block identity before the editor reads from or writes to `chrome.storage.local`. Layout geometry, enabled state, config, and user content are preserved.

## CI Notes

The CI workflow runs `npm ci`, `npm run typecheck`, `npm run build`, and `npm run build:blocker-only`. It does not use `actions/upload-artifact` or `actions/cache`, so there is no artifact/cache retention setting to change.

## Remaining Risk

`src/newtab/editor.js` and `src/newtab/instances.js` still duplicate parts of the TypeScript settings normalization/defaults. This pass keeps the fix minimal; consolidating the JS/TS boundary remains the larger follow-up refactor.
