# Round 46 manual QA — automatic watch recovery

- [ ] Put a harmless unrelated file such as `build/keep.txt` in the normal output directory, run `npm run build`, and confirm the unrelated file survives while generated extension files are refreshed.
- [ ] Run `npm run watch`, wait for a successful build, then temporarily rename the repository-root `icons/` directory. Confirm the rebuild fails and generated extension output is invalidated.
- [ ] Restore `icons/` without editing any TypeScript, HTML, CSS, or manifest file. Confirm watch automatically rebuilds successfully.
- [ ] Repeat the delete/restore cycle for `src/_locales/` and confirm recovery also happens without a source-code edit.
- [ ] Start watch while `icons/` is temporarily absent. Confirm the initial build fails visibly; recreate `icons/` and confirm the same watch process recovers automatically.
- [ ] After recovery, reload the unpacked extension and verify popup, Options, blocked page, Start Tab, service worker, icons, and localization load normally.
