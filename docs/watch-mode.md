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

Before each static copy, watch mode revalidates the build output and removes every generated static target before copying the new revision. If a source asset is deleted or a copy fails, the corresponding stale generated file is left absent rather than silently surviving from an older build. Restore the source and wait for the next successful rebuild before reloading the extension.

For blocker-only watch mode, run:

```bash
node build.mjs --watch --without-newtab --outdir=build-blocker-only
```

That profile intentionally omits and does not watch new-tab assets. Reload the unpacked extension or the affected extension page after each successful rebuild; the watcher updates files on disk but Chromium does not automatically reload an installed unpacked extension.
