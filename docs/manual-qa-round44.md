# Round 44 manual QA — exact static output replacement

- [ ] Run `npm run watch`, wait for a successful build, and load `build/` as an unpacked Chromium extension.
- [ ] Temporarily rename `src/newtab/newtab-gate.js`. Confirm the rebuild fails and the old `build/newtab-gate.js` is no longer present.
- [ ] Restore `src/newtab/newtab-gate.js`. Confirm watch rebuilds successfully and produces a fresh generated file.
- [ ] Repeat the delete/restore check for `src/popup/popup.css` and `src/manifest.json`; stale generated copies must never survive a failed rebuild.
- [ ] Replace a harmless generated static file in `build/` with a local junction or symbolic link. Confirm the next rebuild removes the link itself and does not modify its external target.
- [ ] Replace the whole `build/` directory with a junction or symbolic link while watch is running. Confirm the next rebuild fails closed before static cleanup or writes.
- [ ] Run blocker-only watch mode and confirm shared static outputs are replaced exactly while no new-tab output is introduced.
- [ ] After each successful recovery, reload the unpacked extension and verify popup, Options, blocked page, and Start Tab load without console errors.
