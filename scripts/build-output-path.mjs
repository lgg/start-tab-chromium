import path from "node:path";

function samePath(left, right) {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function isStrictDescendant(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * Resolve a build output directory without allowing recursive cleanup to target
 * the repository, its source folders, a filesystem root, or an arbitrary host
 * directory. Repository-local outputs must live under a top-level build* path;
 * external outputs are allowed only below the operating-system temp directory.
 */
export function resolveSafeBuildOutput(root, temporaryRoot, requested) {
  const repositoryRoot = path.resolve(root);
  const tempRoot = path.resolve(temporaryRoot);
  const candidate = path.resolve(repositoryRoot, requested);
  const volumeRoot = path.parse(candidate).root;

  if (samePath(candidate, volumeRoot)) {
    throw new Error(`Refusing to use a filesystem root as build output: ${candidate}`);
  }
  if (samePath(candidate, repositoryRoot) || isStrictDescendant(candidate, repositoryRoot)) {
    throw new Error(`Refusing to use the repository or its parent as build output: ${candidate}`);
  }

  if (isStrictDescendant(repositoryRoot, candidate)) {
    const [topLevel = ""] = path.relative(repositoryRoot, candidate).split(path.sep);
    if (!/^build(?:$|[-_.])/.test(topLevel)) {
      throw new Error(`Repository-local build output must use a top-level build* directory: ${candidate}`);
    }
    return candidate;
  }

  if (!isStrictDescendant(tempRoot, candidate)) {
    throw new Error(`External build output must be inside the operating-system temp directory: ${candidate}`);
  }
  return candidate;
}
