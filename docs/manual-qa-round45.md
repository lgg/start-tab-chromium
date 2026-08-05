# Round 45 manual QA — failed rebuild invalidation

- [ ] Run `npm run watch`, wait for a successful build, and load `build/` as an unpacked Chromium extension.
- [ ] Introduce a temporary TypeScript syntax error in `src/popup/popup.ts`. Confirm the rebuild fails and generated JS/static extension files disappear instead of leaving the previous working build in place.
- [ ] Restore the TypeScript source. Confirm all generated files return only after a successful rebuild, then reload the extension and verify the popup works.
- [ ] Temporarily rename the root `icons/` directory. Confirm watch reports an input error and the previous generated extension output is invalidated.
- [ ] Restore `icons/`. Confirm a complete successful rebuild recreates the icon tree and all other outputs.
- [ ] Repeat the root-directory failure/recovery check for `src/_locales/`.
- [ ] Temporarily make `src/manifest.json` invalid JSON. Confirm successful bundling followed by finalization failure leaves no partial bundle/static mixture in `build/`.
- [ ] Restore the manifest. Confirm the next successful rebuild recreates a complete loadable extension.
- [ ] Run blocker-only watch mode and repeat a compile failure. Confirm shared blocker outputs disappear while no full new-tab output is introduced.
- [ ] After every recovery, inspect popup, Options, blocked page, Start Tab, service worker, and extension console for errors.
