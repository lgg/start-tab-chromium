# Round 39 manual QA — clock targets and layout-editor concurrency

The checks below include the case where a block settings dialog is open during an external update.

- [ ] Start a Timer, Stopwatch, or Pomodoro in one Start Tab, then remove that block or change its type from another context before pressing Start/Pause/Reset in the stale tab; confirm the action is rejected and canonical state is reloaded.
- [ ] Enter Layout Editor without changing anything, apply an external settings change while the editor is open but still clean, then make a local edit; confirm the draft includes the external change rather than overwriting it.
- [ ] Rapidly double-activate Save layout and try changing mode, zone, palette items, or card controls while the save is pending; confirm only one write occurs, controls stay unavailable until settlement, and failure restores the editable draft.
- [ ] Keep a block settings dialog open, change that block externally, then submit the stale dialog result; confirm it is rejected instead of replacing the newer block configuration.
