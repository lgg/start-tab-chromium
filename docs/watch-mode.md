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

The build lifecycle also invalidates every generated JavaScript and static output before each rebuild attempt. This happens before TypeScript compilation and before static-input collection, so syntax errors, missing required static inputs, and other early failures cannot leave an older apparently valid extension behind. A failed rebuild leaves the generated extension incomplete and visibly absent; all generated outputs return only after a complete successful rebuild. Unrelated files in the output directory are preserved both when the build command starts and during later rebuilds.

Every required static input is validated before finalization. Explicit assets such as `manifest.json`, popup/options/blocked HTML and CSS, shared CSS, and full-profile new-tab assets must be real regular files. Recursive roots `icons/` and `src/_locales/` must be real directories containing only regular files/directories. Missing explicit files or recursive roots are reported as structured build errors while their containing directories remain watched, so restoring them can recover the same watch process without an unrelated edit. Links, junctions, wrong-type roots, and other special filesystem entries are rejected without traversal. The same validation runs during ordinary one-shot/release builds that do not register the watch plugin.

Static output writes are serialized and guarded individually. After source validation, the selected build output is revalidated again immediately before every copy and before the transformed manifest write. A source-tree scan therefore cannot reopen the output-link replacement window. Serial copy batches also ensure that a failed copy is not reported to lifecycle cleanup while a sibling `cp()` is still running; no late writer can recreate generated output after failure cleanup completes.

Generated-output cleanup covers the complete known extension artifact set even when the selected profile omits some files. Reusing the same safe `--outdir` across profiles therefore cannot leave full/new-tab artifacts behind after a blocker-only build, while unrelated files that are not owned by the build remain untouched. Cleanup starts from the trusted repository/temporary root rather than treating the mutable `outdir` as its own trust boundary, so each generated-path removal checks the selected output directory as an intermediate filesystem segment.

For blocker-only watch mode, run:

```bash
node build.mjs --watch --without-newtab --outdir=build-blocker-only
```

That profile intentionally omits and does not watch new-tab assets. Reload the unpacked extension or the affected extension page after each successful rebuild; the watcher updates files on disk but Chromium does not automatically reload an installed unpacked extension.
