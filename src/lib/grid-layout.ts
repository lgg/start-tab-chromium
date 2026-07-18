import { MAX_GRID_BLOCK_HEIGHT, MAX_GRID_ROW } from "./platform-limits.js";
import { blockDescriptor } from "./start-page-defaults.js";
import type { BlockInstance } from "./start-page-types.js";

function horizontalOverlap(left: BlockInstance, right: BlockInstance): boolean {
  return left.column < right.column + right.width
    && left.column + left.width > right.column;
}

function verticalOverlap(left: BlockInstance, right: BlockInstance): boolean {
  return left.row < right.row + right.height
    && left.row + left.height > right.row;
}

export function gridBlocksOverlap(left: BlockInstance, right: BlockInstance): boolean {
  return left.zone === right.zone
    && horizontalOverlap(left, right)
    && verticalOverlap(left, right);
}

export function clampGridBlock(block: BlockInstance, columns: number): BlockInstance {
  const descriptor = blockDescriptor(block.type);
  const safeColumns = Math.max(1, Math.round(columns));
  const minimumWidth = Math.min(descriptor.minGridWidth, safeColumns);
  const width = Math.min(safeColumns, Math.max(minimumWidth, Math.round(block.width)));
  const height = Math.min(
    MAX_GRID_BLOCK_HEIGHT,
    Math.max(descriptor.minGridHeight, Math.round(block.height)),
  );
  return {
    ...block,
    width,
    height,
    column: Math.max(1, Math.min(Math.round(block.column), Math.max(1, safeColumns - width + 1))),
    row: Math.max(1, Math.min(Math.round(block.row), MAX_GRID_ROW)),
  };
}

function firstAvailableRow(
  candidate: BlockInstance,
  blockers: readonly BlockInstance[],
  startRow: number,
): number | null {
  let row = Math.max(1, Math.min(Math.round(startRow), MAX_GRID_ROW));
  const intervals = blockers
    .filter((block) => horizontalOverlap(candidate, block))
    .map((block) => ({ start: block.row, end: block.row + block.height }))
    .sort((left, right) => left.start - right.start || left.end - right.end);

  for (const interval of intervals) {
    if (interval.end <= row) continue;
    if (row + candidate.height <= interval.start) return row;
    row = Math.max(row, interval.end);
    if (row > MAX_GRID_ROW) return null;
  }
  return row <= MAX_GRID_ROW ? row : null;
}

/**
 * Place one block without overlap. The search jumps past occupied intervals
 * instead of relying on an arbitrary retry count, so the full 1,000-block
 * supported capacity remains usable in a dense one-column layout.
 */
export function placeGridBlock(
  block: BlockInstance,
  blocks: readonly BlockInstance[],
  columns: number,
): BlockInstance {
  const candidate = clampGridBlock(block, columns);
  if (!candidate.enabled) return candidate;
  const blockers = blocks
    .filter((other) => other.id !== candidate.id && other.enabled && other.zone === candidate.zone)
    .map((other) => clampGridBlock(other, columns));
  const row = firstAvailableRow(candidate, blockers, candidate.row)
    ?? firstAvailableRow(candidate, blockers, 1);
  if (row === null) {
    throw new Error("Unable to place Start Tab block inside the supported grid range");
  }
  return { ...candidate, row };
}

export function placeGridBlocks(blocks: readonly BlockInstance[], columns: number): BlockInstance[] {
  const placed: BlockInstance[] = [];
  for (const block of blocks) placed.push(placeGridBlock(block, placed, columns));
  return placed;
}
