# Development watch mode

Run the full extension watcher from the repository root:

```bash
npm ci
npm run watch
```

The watcher rebuilds the imported TypeScript graph and recopies every static extension asset into `build/`. HTML, CSS, manifest, locale, icon, and early gate changes therefore take effect without restarting the command.

Static coverage includes:

- popup, blocked-page, Options, and shared styles/markup;
- full-build new-tab markup, styles, and `newtab-gate.js`;
- `src/manifest.json` with the normal profile transformations;
- every regular file below `src/_locales/` and `icons/`.

Before each static copy, watch mode revalidates the build output immediately before static finalization and removes every generated static target before copying the new revision. If a source asset is deleted or a copy fails, the corresponding stale generated file is left absent rather than silently surviving from an older build. Restore the source and wait for the next successful rebuild before reloading the extension.

The build lifecycle also invalidates every generated JavaScript and static output before each rebuild attempt. This happens before TypeScript compilation and before recursive static-input collection, so syntax errors, missing `icons/` or `_locales/` roots, and other early failures cannot leave an older apparently valid extension behind. A failed rebuild leaves the generated extension incomplete and visibly absent; all generated outputs return only after a complete successful rebuild. Unrelated files in the output directory are preserved both when the build command starts and during later rebuilds.

Missing recursive static roots remain recoverable without restarting watch mode. The watcher keeps the existing parent directories of `icons/` and `src/_locales/` under observation while reporting the missing root as a build error. Recreating either required directory therefore triggers an automatic rebuild even when no TypeScript, HTML, CSS, or manifest file is edited. Wrong-type roots and root or nested links, junctions, and other special filesystem entries are rejected as structured build errors without traversing them; their containing real directory remains watched so correcting the filesystem entry can recover the same watch process automatically. The same recursive-tree validation runs again during every successful static finalization, including ordinary one-shot/release builds that do not register the watch plugin.

Generated-output cleanup covers the complete known extension artifact set even when the selected profile omits some files. Reusing the same safe `--outdir` across profiles therefore cannot leave full/new-tab artifacts behind after a blocker-only build, while unrelated files that are not owned by the build remain untouched.

For blocker-only watch mode, run:

```bash
node build.mjs --watch --without-newtab --outdir=build-blocker-only
```

That profile intentionally omits and does not watch new-tab assets. Reload the unpacked extension or the affected extension page after each successful rebuild; the watcher updates files on disk but Chromium does not automatically reload an installed unpacked extension.
