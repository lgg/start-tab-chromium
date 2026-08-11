import { readdir } from "node:fs/promises";
import path from "node:path";

export const STATIC_ASSET_WATCH_IMPORT = "start-tab:static-assets";
const STATIC_ASSET_WATCH_NAMESPACE = "start-tab-static-assets";

function uniqueResolved(paths) {
  return [...new Set(paths.map((value) => path.resolve(value)))].sort((left, right) => left.localeCompare(right));
}

function isMissingPath(error) {
  return Boolean(error)
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOENT";
}

async function listRegularTree(directory) {
  const files = [];
  const directories = [];
  const missingDirectories = [];

  async function visit(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (isMissingPath(error)) {
        missingDirectories.push(current);
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
  return { files, directories, missingDirectories };
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
  const watchFiles = uniqueResolved([
    ...explicitStaticAssetSources(root, blockerOnly),
    ...recursiveFiles,
  ]);
  const watchDirs = uniqueResolved([
    ...recursiveDirectories.map((directory) => path.dirname(directory)),
    ...traversedDirectories,
    ...watchFiles.map((file) => path.dirname(file)),
  ]);
  return { watchFiles, watchDirs, missingDirectories };
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
        return {
          contents: "",
          loader: "js",
          watchFiles: inputs.watchFiles,
          watchDirs: inputs.watchDirs,
          ...(inputs.missingDirectories.length > 0
            ? {
                errors: inputs.missingDirectories.map((directory) => ({
                  text: `Required static asset directory is missing: ${directory}`,
                })),
              }
            : {}),
        };
      });
    },
  };
}
