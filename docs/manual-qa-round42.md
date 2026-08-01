# Round 42 manual QA — onboarding across extension contexts

- [ ] Open two Start Tab tabs before onboarding is complete. In the first tab, skip onboarding. Confirm the onboarding dialog closes automatically in the second tab without applying another preset.
- [ ] Repeat with two Start Tab tabs and choose different preset buttons nearly simultaneously. Confirm only the first completion changes the layout and the other tab dismisses its stale dialog.
- [ ] Complete onboarding, keep a Start Tab open, then use Options to reset Start Tab. Confirm the open tab shows onboarding again after canonical settings/runtime reload.
- [ ] Import a backup with `startPageOnboarding.onboarded` set to false while another Start Tab is open. Confirm that tab refreshes and shows onboarding.
- [ ] Import a backup with onboarding already complete while a stale onboarding dialog is open. Confirm the dialog closes.
- [ ] While the disabled-content or Split View gate is visible, reset or import onboarding state. Confirm onboarding waits for the gate to close and appears only afterward.
- [ ] Start editing a layout, then change onboarding state from another context. Confirm unsaved layout content is not silently replaced.
- [ ] Verify focus returns to the previously focused connected control when a remote completion dismisses onboarding.
