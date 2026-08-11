# Round 49 manual QA — guarded bundle and source finalization

- [ ] Run the normal full build and reload the unpacked extension. Verify service worker, popup, Options, blocked page, Start Tab, icons, localization, and manifest behavior still work normally.
- [ ] Run blocker-only and Google-enabled builds and verify their exact profile behavior is unchanged; blocker-only must contain no `newtab.*` bundle/static outputs.
- [ ] Start `npm run watch`, temporarily replace `src/popup/popup.html` after a successful rebuild, and confirm the next finalization fails instead of copying the replaced source. Restore the real file and confirm watch recovers.
- [ ] Repeat with `src/manifest.json`; confirm the transformed manifest is not read from a link/wrong-type replacement and no stale generated manifest survives the failed rebuild.
- [ ] Repeat with the root `icons/` directory and confirm recursive per-operation validation rejects a late link/junction replacement before copy.
- [ ] During a controlled development fixture, replace `build/` with a harmless junction/symlink after compilation but immediately before bundle materialization. Confirm no JavaScript bundle is written through it.
- [ ] Temporarily alter an isolated esbuild fixture to return an unexpected extra output and confirm finalization rejects the bundle set before writing any expected bundle.
- [ ] After all recovery scenarios, run the complete regression suite and verify no generated output remains after any intentionally failed finalization.
