import { lstat, rm } from "node:fs/promises";
import path from "node:path";

function samePath(left, right) {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function isStrictDescendant(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return Boolean(relative)
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function missingPath(error) {
  return Boolean(error)
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOENT";
}

export function resolveStrictDescendant(boundary, requested) {
  const root = path.resolve(boundary);
  const candidate = path.resolve(root, requested);
  const volumeRoot = path.parse(root).root;
  if (samePath(root, volumeRoot)) {
    throw new Error(`Refusing to use a filesystem root as a cleanup boundary: ${root}`);
  }
  if (!isStrictDescendant(root, candidate)) {
    throw new Error(`Cleanup target must be strictly inside its boundary: ${candidate}`);
  }
  return { root, candidate };
}

/**
 * Reject every existing symbolic link or Windows junction below a trusted
 * boundary. Missing descendants are safe because a new ordinary tree may be
 * created there later.
 */
export async function assertPathContainsNoLinks(boundary, requested) {
  const { root, candidate } = resolveStrictDescendant(boundary, requested);
  const relative = path.relative(root, candidate);
  let current = root;

  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error(`Refusing to traverse a symbolic link or junction: ${current}`);
      }
    } catch (error) {
      if (missingPath(error)) return;
      throw error;
    }
  }
}

/**
 * Remove one target below a trusted boundary without recursively traversing a
 * final symbolic link or Windows junction. Intermediate links are rejected;
 * a final link is removed as the link itself and its external target survives.
 */
export async function removePathWithinBoundary(boundary, requested) {
  const { root, candidate } = resolveStrictDescendant(boundary, requested);
  const relative = path.relative(root, candidate);
  const segments = relative.split(path.sep).filter(Boolean);
  let current = root;

  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    try {
      const stats = await lstat(current);
      if (!stats.isSymbolicLink()) continue;
      if (!samePath(current, candidate)) {
        throw new Error(`Refusing to traverse an intermediate symbolic link or junction: ${current}`);
      }
      await rm(current, { recursive: true, force: true });
      return true;
    } catch (error) {
      if (missingPath(error)) return false;
      throw error;
    }
  }

  await rm(candidate, { recursive: true, force: true });
  return true;
}
