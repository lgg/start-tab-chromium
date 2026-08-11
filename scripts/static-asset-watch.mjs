import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

export const STATIC_ASSET_WATCH_IMPORT = "start-tab:static-assets";
const STATIC_ASSET_WATCH_NAMESPACE = "start-tab-static-assets";

function uniqueResolved(paths) {
  return [...new Set(paths.map((value) => path.resolve(value)))].sort((left, right) => left.localeCompare(right));
}

function errorCodeIs(error, code) {
  return Boolean(error)
    && typeof error === "object"
    && "code" in error
    && error.code === code;
}

async function listRegularTree(directory) {
  const files = [];
  const directories = [];
  const missingDirectories = [];
  const invalidDirectories = [];

  async function visit(current) {
    let status;
    try {
      status = await lstat(current);
    } catch (error) {
      if (errorCodeIs(error, "ENOENT")) {
        missingDirectories.push(current);
        return;
      }
      throw error;
    }

    // lstat() deliberately does not follow a symbolic link or Windows
    // junction. Recursive static roots and nested directories must stay real
    // directories inside the repository instead of silently traversing an
    // external tree.
    if (!status.isDirectory()) {
      invalidDirectories.push(current);
      return;
    }

    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (errorCodeIs(error, "ENOENT")) {
        missingDirectories.push(current);
        return;
      }
      // The directory may have been replaced with a file/link after lstat().
      // Keep the failure structured so the already-watched parent can recover
      // when the correct directory is restored.
      if (errorCodeIs(error, "ENOTDIR")) {
        invalidDirectories.push(current);
        return;
      }
      throw error;
    }

    directories.push(current);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      } else {
        throw new Error(`Static asset trees must contain regular files and directories only: ${absolute}`);
      }
    }
  }

  await visit(directory);
  return { files, directories, missingDirectories, invalidDirectories };
}

export function explicitStaticAssetSources(root, blockerOnly = false) {
  const source = (...parts) => path.join(root, "src", ...parts);
  const files = [
    source("manifest.json"),
    source("popup", "popup.html"),
    source("popup", "popup.css"),
    source("blocked", "blocked.html"),
    source("blocked", "blocked.css"),
    source("options", "options.html"),
    source("options", "options.css"),
    source("shared-ui.css"),
  ];
  if (!blockerOnly) {
    files.push(
      source("newtab", "newtab.html"),
      source("newtab", "newtab.css"),
      source("newtab", "newtab-gate.js"),
    );
  }
  return uniqueResolved(files);
}

export async function collectStaticAssetWatchInputs(root, blockerOnly = false) {
  const recursiveDirectories = [
    path.join(root, "icons"),
    path.join(root, "src", "_locales"),
  ];
  const trees = await Promise.all(recursiveDirectories.map(listRegularTree));
  const recursiveFiles = trees.flatMap((tree) => tree.files);
  const traversedDirectories = trees.flatMap((tree) => tree.directories);
  const missingDirectories = uniqueResolved(trees.flatMap((tree) => tree.missingDirectories));
  const invalidDirectories = uniqueResolved(trees.flatMap((tree) => tree.invalidDirectories));
  const watchFiles = uniqueResolved([
    ...explicitStaticAssetSources(root, blockerOnly),
    ...recursiveFiles,
  ]);
  const watchDirs = uniqueResolved([
    ...recursiveDirectories.map((directory) => path.dirname(directory)),
    ...traversedDirectories,
    ...watchFiles.map((file) => path.dirname(file)),
  ]);
  return { watchFiles, watchDirs, missingDirectories, invalidDirectories };
}

export function createStaticAssetWatchPlugin(root, blockerOnly = false) {
  return {
    name: "watch-static-extension-assets",
    setup(build) {
      build.onResolve({ filter: /^start-tab:static-assets$/ }, () => ({
        path: "anchor",
        namespace: STATIC_ASSET_WATCH_NAMESPACE,
      }));
      build.onLoad({ filter: /.*/, namespace: STATIC_ASSET_WATCH_NAMESPACE }, async () => {
        const inputs = await collectStaticAssetWatchInputs(root, blockerOnly);
        const errors = [
          ...inputs.missingDirectories.map((directory) => ({
            text: `Required static asset directory is missing: ${directory}`,
          })),
          ...inputs.invalidDirectories.map((directory) => ({
            text: `Required static asset path must be a real directory, not a file, symbolic link, or junction: ${directory}`,
          })),
        ];
        return {
          contents: "",
          loader: "js",
          watchFiles: inputs.watchFiles,
          watchDirs: inputs.watchDirs,
          ...(errors.length > 0 ? { errors } : {}),
        };
      });
    },
  };
}
