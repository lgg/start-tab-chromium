# Round 47 manual QA — finalization and static-tree safety

- [ ] Build full mode into a safe custom directory such as `build-shared`, then build blocker-only into the same `--outdir`. Confirm `newtab.js`, `newtab.html`, `newtab.css`, and `newtab-gate.js` are absent while an unrelated `keep.txt` survives.
- [ ] Start `npm run watch`, replace `icons/` temporarily with a regular file, and confirm a visible wrong-type static-tree error appears instead of an unstructured watcher crash.
- [ ] Remove that wrong-type file and recreate `icons/` as a real directory without editing source code. Confirm the same watch process recovers automatically.
- [ ] On Windows, temporarily replace `icons/` with a junction to a harmless external test directory; on POSIX use a directory symlink. Confirm the build rejects the link, does not traverse external files, and recovers after restoring a real directory.
- [ ] Create a harmless nested junction/symlink inside `icons/`. Confirm the build fails visibly and automatically recovers after the nested link is removed.
- [ ] During a controlled development test, replace the selected build output with a junction/symlink after compilation but before static finalization. Confirm finalization is rejected before HTML/CSS/icons/locales/manifest can be copied through that path.
- [ ] After all recovery cases, reload the unpacked extension and verify popup, Options, blocked page, Start Tab, service worker, icons, localization, and blocker-only behavior still load normally.
