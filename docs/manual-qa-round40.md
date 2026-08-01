# Round 40 manual QA — Options concurrency

- [ ] Open the same block in Options in two profiles/tabs. Save a change in one, then submit the older dialog in the other; confirm the stale dialog is rejected and Options reloads the newer block.
- [ ] Repeat with a custom theme, including deleting the theme while its editor is open; confirm the stale editor cannot recreate it.
- [ ] Leave Options stale, change a block elsewhere, then activate Enable/Disable or Duplicate; confirm the stale action is rejected rather than inverting/duplicating unseen state.
- [ ] Confirm Clear instance data, change either the block or its runtime in another Start Tab before the request commits, and verify the clear is rejected without data/alarm loss.
- [ ] Rapidly double-activate an Options mutation; confirm exactly one mutation runs, the Options regions are inert and `aria-busy` during it, and controls recover afterward.
- [ ] Force a mutation conflict/failure; confirm the error remains visible while the Blocks/Themes/runtime display reloads to canonical current state.
- [ ] Open `docs/roadmap-implementation-2026-07-13.md` and confirm every completed 3.0.0 requirement is marked complete rather than pending.
