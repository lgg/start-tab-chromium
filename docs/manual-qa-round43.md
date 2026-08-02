# Round 43 manual QA — static asset watch coverage

- [ ] Run `npm run watch`, wait for the initial full build, and load `build/` as an unpacked Chromium extension.
- [ ] Change visible text or markup in `src/newtab/newtab.html`. Confirm watch rebuilds without restarting the command and the generated `build/newtab.html` changes.
- [ ] Change a rule in `src/newtab/newtab.css`. Confirm watch rebuilds and the unpacked Start Tab reflects the change after reload.
- [ ] Change a message in an English or Russian locale catalog. Confirm the corresponding file under `build/_locales/` is refreshed automatically.
- [ ] Change `src/newtab/newtab-gate.js`. Confirm `build/newtab-gate.js` is refreshed automatically and the early gate still loads without a console error.
- [ ] Change a harmless manifest field, such as the description, and confirm `build/manifest.json` is regenerated automatically with the ordinary non-Google profile still omitting `oauth2` and `identity`.
- [ ] Replace an icon file and confirm the matching file under `build/icons/` changes without restarting watch.
- [ ] Temporarily delete and restore a watched static asset. Confirm the failed rebuild is visible, restoration triggers another rebuild, and the watch process recovers.
- [ ] Start `node build.mjs --watch --without-newtab --outdir=build-round43-blocker-watch`. Confirm popup/options/blocked assets, locales, icons, and manifest refresh, while new-tab files remain absent.
