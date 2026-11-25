import { MAX_FREE_GEOMETRY } from "../lib/platform-limits.js";
import { blockDescriptor } from "../lib/start-page-defaults.js";
import type { BlockInstance } from "../lib/start-page-types.js";

export function clampFreeGeometry(block: BlockInstance): BlockInstance {
  const descriptor = blockDescriptor(block.type);
  const clamp = (value: number, min: number): number =>
    Math.min(MAX_FREE_GEOMETRY, Math.max(min, Number.isFinite(value) ? value : min));
  return { ...block, free: {
    x: clamp(block.free.x, 0),
    y: clamp(block.free.y, 0),
    width: clamp(block.free.width, descriptor.minFreeWidth),
    height: clamp(block.free.height, descriptor.minFreeHeight),
  } };
}

/** Exact baseline and generation of one editable layout draft. */
export class LayoutDraftVersion {
  private generation = 0;
  constructor(private baseline: number) {}
  get updatedAt(): number { return this.baseline; }
  get epoch(): number { return this.generation; }
  change(): void { this.generation += 1; }
  reset(updatedAt: number): void { this.baseline = updatedAt; this.change(); }
  isCurrent(epoch: number): boolean { return this.generation === epoch; }
}
