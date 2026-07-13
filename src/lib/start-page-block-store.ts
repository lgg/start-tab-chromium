import {
  LAYOUT_PRESETS,
  blockDescriptor,
  blocksFromPreset,
  cloneBlock,
  cloneSettings,
  createBlockId,
  createBlockInstance,
  isSingletonBlockType,
} from "./start-page-defaults.js";
import { getStartPageSettings, setStartPageSettings } from "./start-page-settings-store.js";
import type {
  BlockInstance,
  BlockInstanceFor,
  BlockType,
  LayoutMode,
  LayoutPresetId,
  LayoutZone,
  StartPageSettings,
} from "./start-page-types.js";

export function canAddBlock(settings: StartPageSettings, type: BlockType): boolean {
  return !isSingletonBlockType(type) || !settings.layout.blocks.some((block) => block.type === type);
}

function nextGridPosition(settings: StartPageSettings): { column: number; row: number } {
  const maxRow = settings.layout.blocks.reduce((maximum, block) => Math.max(maximum, block.row + block.height), 1);
  return { column: 1, row: Math.max(1, maxRow + 1) };
}

export async function addBlockInstance<T extends BlockType>(type: T): Promise<BlockInstanceFor<T>> {
  const current = await getStartPageSettings();
  if (!canAddBlock(current, type)) throw new Error(`Singleton block already exists: ${type}`);
  const position = nextGridPosition(current);
  const block = createBlockInstance(type, {
    ...position,
    zone: current.layout.zone,
    order: current.layout.blocks.length,
  });
  await setStartPageSettings({
    ...current,
    layout: { ...current.layout, profile: "custom", blocks: [...current.layout.blocks, block] },
  });
  return block;
}

export async function updateBlockInstance(
  id: string,
  updater: (block: BlockInstance) => BlockInstance,
): Promise<BlockInstance> {
  const current = await getStartPageSettings();
  const existing = current.layout.blocks.find((block) => block.id === id);
  if (!existing) throw new Error(`Block instance not found: ${id}`);
  const candidate = updater(cloneBlock(existing));
  if (candidate.id !== id || candidate.type !== existing.type) throw new Error("Block identity and type cannot be changed");
  const blocks = current.layout.blocks.map((block) => block.id === id ? candidate : block);
  await setStartPageSettings({ ...current, layout: { ...current.layout, profile: "custom", blocks } });
  const saved = (await getStartPageSettings()).layout.blocks.find((block) => block.id === id);
  if (!saved) throw new Error(`Block instance disappeared after save: ${id}`);
  return saved;
}

export async function setBlockEnabled(id: string, enabled: boolean): Promise<BlockInstance> {
  return updateBlockInstance(id, (block) => ({ ...block, enabled }));
}

export async function duplicateBlockInstance(id: string): Promise<BlockInstance> {
  const current = await getStartPageSettings();
  const source = current.layout.blocks.find((block) => block.id === id);
  if (!source) throw new Error(`Block instance not found: ${id}`);
  if (isSingletonBlockType(source.type)) throw new Error(`Singleton block cannot be duplicated: ${source.type}`);
  const now = Date.now();
  const duplicate = {
    ...cloneBlock(source),
    id: createBlockId(source.type),
    title: `${source.title} copy`,
    column: Math.min(current.layout.columns, source.column + 1),
    row: source.row + 1,
    order: current.layout.blocks.length,
    free: { ...source.free, x: source.free.x + 24, y: source.free.y + 24 },
    createdAt: now,
    updatedAt: now,
  } as BlockInstance;
  await setStartPageSettings({
    ...current,
    layout: { ...current.layout, profile: "custom", blocks: [...current.layout.blocks, duplicate] },
  });
  return duplicate;
}

export async function removeBlockInstance(id: string): Promise<BlockInstance> {
  const current = await getStartPageSettings();
  const removed = current.layout.blocks.find((block) => block.id === id);
  if (!removed) throw new Error(`Block instance not found: ${id}`);
  await setStartPageSettings({
    ...current,
    layout: {
      ...current.layout,
      profile: "custom",
      blocks: current.layout.blocks.filter((block) => block.id !== id).map((block, order) => ({ ...block, order })),
    },
  });
  return removed;
}

export async function applyLayoutPreset(presetId: LayoutPresetId): Promise<StartPageSettings> {
  const current = await getStartPageSettings();
  const preset = LAYOUT_PRESETS.find((item) => item.id === presetId);
  if (!preset) throw new Error(`Unknown layout preset: ${presetId}`);
  const next = cloneSettings(current);
  next.layout.columns = preset.columns;
  next.layout.profile = preset.id;
  next.layout.blocks = blocksFromPreset(preset, current.layout.zone);
  await setStartPageSettings(next);
  return getStartPageSettings();
}

export async function setLayoutMode(mode: LayoutMode): Promise<StartPageSettings> {
  const current = await getStartPageSettings();
  await setStartPageSettings({ ...current, layout: { ...current.layout, mode, profile: "custom" } });
  return getStartPageSettings();
}

export async function setLayoutZone(zone: LayoutZone): Promise<StartPageSettings> {
  const current = await getStartPageSettings();
  await setStartPageSettings({
    ...current,
    layout: {
      ...current.layout,
      zone,
      profile: "custom",
      blocks: current.layout.blocks.map((block) => ({ ...block, zone })),
    },
  });
  return getStartPageSettings();
}

export function minimumGridSize(type: BlockType): { width: number; height: number } {
  const descriptor = blockDescriptor(type);
  return { width: descriptor.minGridWidth, height: descriptor.minGridHeight };
}
