# Round 48 manual QA — static finalization race safety

- [ ] Start `npm run watch`, temporarily replace `src/popup/popup.html` with a harmless link/junction or wrong-type entry, and confirm the build reports a structured invalid static-input error instead of copying it.
- [ ] Remove that invalid `popup.html` entirely and confirm watch reports a missing required static file. Restore a real regular file without editing TypeScript and confirm the same watch process recovers automatically.
- [ ] Repeat a missing explicit-file recovery with `src/manifest.json` and confirm no stale generated manifest survives the failed rebuild.
- [ ] During a controlled development test, replace the selected build output with a harmless junction/symlink after static source validation but before the first copied asset. Confirm the next guarded output operation rejects it and writes nothing through the link.
- [ ] Force one static copy operation to fail while another copy is intentionally slow. Confirm finalization waits for the active copy to settle, then cleanup removes generated outputs and no file reappears afterward.
- [ ] Reuse one safe custom `--outdir` across full and blocker-only builds and confirm blocker-only output contains no `newtab.*` artifacts while an unrelated file remains untouched.
- [ ] After recovery tests, run full, blocker-only, and Google-enabled builds and reload the unpacked extension. Verify popup, Options, blocked page, Start Tab, service worker, icons, localization, and blocker-only behavior still work normally.
