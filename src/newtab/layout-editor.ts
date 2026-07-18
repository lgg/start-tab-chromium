import { editBlockInstance } from "../lib/block-settings-editor.js";
import { placeGridBlock, placeGridBlocks } from "../lib/grid-layout.js";
import type { I18n } from "../lib/i18n.js";
import { sendMessage } from "../lib/messages.js";
import { MAX_START_PAGE_BLOCKS } from "../lib/platform-limits.js";
import { instanceRuntimeHasUserData } from "../lib/start-page-runtime.js";
import {
  BLOCK_DESCRIPTORS,
  blockDescriptor,
  canAddBlock,
  cloneBlock,
  cloneSettings,
  createBlockInstance,
  getStartPageSettings,
  hasBlockUserData,
  isSingletonBlockType,
  type BlockInstance,
  type BlockType,
  type LayoutMode,
  type LayoutZone,
  type StartPageRuntimeState,
  type StartPageSettings,
} from "../lib/start-page-settings.js";

interface LayoutEditorOptions {
  i18n: I18n;
  toolbarHost: HTMLElement;
  paletteHost: HTMLElement;
  getRuntime: () => StartPageRuntimeState;
  requestRender: () => void;
  previewBlock: (card: HTMLElement, block: BlockInstance, settings: StartPageSettings) => void;
  onSaved: (settings: StartPageSettings) => void;
  onError: (error: unknown) => void;
}

interface PointerSession {
  pointerId: number;
  blockId: string;
  kind: "move" | "resize";
  startX: number;
  startY: number;
  startBlock: BlockInstance;
  card: HTMLElement;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function button(text: string, className = "button"): HTMLButtonElement {
  const node = element("button", className, text);
  node.type = "button";
  return node;
}

function select<T extends string>(value: T, options: Array<[T, string]>): HTMLSelectElement {
  const node = element("select", "select editor-select");
  for (const [optionValue, label] of options) {
    const option = element("option", "", label);
    option.value = optionValue;
    option.selected = optionValue === value;
    node.append(option);
  }
  return node;
}

function maxGridRow(blocks: readonly BlockInstance[]): number {
  return blocks.reduce((maximum, block) => Math.max(maximum, block.row + block.height), 1);
}

function titleKey(type: BlockType): string {
  return `blockTitle${type[0]?.toUpperCase() ?? ""}${type.slice(1)}`;
}

export class LayoutEditor {
  private saved: StartPageSettings;
  private draft: StartPageSettings;
  private active = false;
  private dirty = false;
  private destructiveRuntimeUpdatedAt: number | null = null;
  private pointerSession: PointerSession | null = null;
  private readonly options: LayoutEditorOptions;

  constructor(settings: StartPageSettings, options: LayoutEditorOptions) {
    this.saved = cloneSettings(settings);
    this.draft = cloneSettings(settings);
    this.options = options;
    this.renderControls();
  }

  get settings(): StartPageSettings {
    return this.active ? this.draft : this.saved;
  }

  get isActive(): boolean {
    return this.active;
  }

  get hasUnsavedChanges(): boolean {
    return this.active && this.dirty;
  }

  replaceSavedSettings(settings: StartPageSettings): void {
    this.saved = cloneSettings(settings);
    if (!this.active) this.draft = cloneSettings(settings);
    this.renderControls();
  }

  enter(): void {
    this.active = true;
    this.dirty = false;
    this.destructiveRuntimeUpdatedAt = null;
    this.draft = cloneSettings(this.saved);
    this.renderControls();
    this.options.requestRender();
  }

  async save(): Promise<void> {
    if (!this.active) return;
    await sendMessage({
      type: "replace-start-page-settings",
      settings: this.draft,
      expectedSettingsUpdatedAt: this.saved.updatedAt,
      expectedRuntimeUpdatedAt: this.destructiveRuntimeUpdatedAt ?? this.options.getRuntime().updatedAt,
    });
    const persisted = await getStartPageSettings();
    this.saved = cloneSettings(persisted);
    this.draft = cloneSettings(persisted);
    this.active = false;
    this.dirty = false;
    this.destructiveRuntimeUpdatedAt = null;
    this.renderControls();
    this.options.onSaved(cloneSettings(this.saved));
    this.options.requestRender();
  }

  cancel(): void {
    if (!this.active) return;
    if (this.dirty && !window.confirm(this.options.i18n.t("discardChangesConfirm"))) return;
    this.draft = cloneSettings(this.saved);
    this.active = false;
    this.dirty = false;
    this.destructiveRuntimeUpdatedAt = null;
    this.renderControls();
    this.options.requestRender();
  }

  decorateCard(card: HTMLElement, block: BlockInstance): void {
    card.dataset.blockId = block.id;
    card.dataset.blockType = block.type;
    if (!this.active) return;
    card.classList.add("card--editing");
    card.tabIndex = 0;
    card.setAttribute("aria-label", this.options.i18n.t("editableBlockLabel", { title: block.title }));
    card.addEventListener("keydown", (event) => this.handleCardKeydown(event, block.id));

    const controls = element("div", "card-editor-controls");
    const drag = button("⠿", "icon-button card__drag-handle");
    drag.title = this.options.i18n.t("moveBlock");
    drag.setAttribute("aria-label", drag.title);
    drag.addEventListener("pointerdown", (event) => this.startPointerSession(event, block.id, card, "move"));

    const settings = button("⚙", "icon-button");
    settings.title = this.options.i18n.t("editBlock");
    settings.setAttribute("aria-label", settings.title);
    settings.addEventListener("click", () => this.runAsync(() => this.configure(block.id)));

    const enabled = button(block.enabled ? "◉" : "○", "icon-button");
    enabled.title = this.options.i18n.t(block.enabled ? "disableBlock" : "enableBlock");
    enabled.setAttribute("aria-label", enabled.title);
    enabled.addEventListener("click", () => this.toggleBlockEnabled(block.id));

    controls.append(drag, settings, enabled);
    if (!isSingletonBlockType(block.type)) {
      const duplicate = button("⧉", "icon-button");
      duplicate.disabled = this.draft.layout.blocks.length >= MAX_START_PAGE_BLOCKS;
      duplicate.title = duplicate.disabled
        ? this.options.i18n.t("blockCapacityReached", { count: MAX_START_PAGE_BLOCKS })
        : this.options.i18n.t("duplicateBlock");
      duplicate.setAttribute("aria-label", duplicate.title);
      duplicate.addEventListener("click", () => this.duplicate(block.id));
      controls.append(duplicate);
    }
    const remove = button("×", "icon-button icon-button--danger");
    remove.title = this.options.i18n.t("deleteBlock");
    remove.setAttribute("aria-label", remove.title);
    remove.addEventListener("click", () => this.remove(block.id));
    controls.append(remove);

    const resize = button("↘", "icon-button card__resize-handle");
    resize.title = this.options.i18n.t("resizeBlock");
    resize.setAttribute("aria-label", resize.title);
    resize.addEventListener("pointerdown", (event) => this.startPointerSession(event, block.id, card, "resize"));
    card.prepend(controls);
    card.append(resize);
  }

  private runAsync(action: () => Promise<void>): void {
    void action().catch(this.options.onError);
  }

  private mutate(mutator: (settings: StartPageSettings) => StartPageSettings): void {
    this.draft = mutator(cloneSettings(this.draft));
    this.draft.layout.profile = "custom";
    this.dirty = true;
    this.renderControls();
    this.options.requestRender();
  }

  private updateBlock(id: string, updater: (block: BlockInstance) => BlockInstance): void {
    this.mutate((settings) => ({
      ...settings,
      layout: {
        ...settings.layout,
        blocks: settings.layout.blocks.map((block) => block.id === id ? updater(cloneBlock(block)) : block),
      },
    }));
  }

  private toggleBlockEnabled(id: string): void {
    this.mutate((settings) => {
      const current = settings.layout.blocks.find((block) => block.id === id);
      if (!current) return settings;
      let replacement = { ...cloneBlock(current), enabled: !current.enabled };
      if (replacement.enabled && settings.layout.mode === "grid") {
        replacement = placeGridBlock(replacement, settings.layout.blocks, settings.layout.columns);
      }
      return {
        ...settings,
        layout: {
          ...settings.layout,
          blocks: settings.layout.blocks.map((block) => block.id === id ? replacement : block),
        },
      };
    });
  }

  private async configure(id: string): Promise<void> {
    const block = this.draft.layout.blocks.find((candidate) => candidate.id === id);
    if (!block) return;
    const configured = await editBlockInstance(block, this.options.i18n);
    if (configured) this.updateBlock(id, () => configured);
  }

  private duplicate(id: string): void {
    const source = this.draft.layout.blocks.find((block) => block.id === id);
    if (!source || isSingletonBlockType(source.type) || this.draft.layout.blocks.length >= MAX_START_PAGE_BLOCKS) return;
    const copy = createBlockInstance(source.type, {
      ...cloneBlock(source),
      id: undefined,
      title: `${source.title} ${this.options.i18n.t("copySuffix")}`,
      column: source.column + 1,
      row: source.row + 1,
      order: this.draft.layout.blocks.length,
      free: { ...source.free, x: source.free.x + 24, y: source.free.y + 24 },
      config: source.config,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const placed = this.draft.layout.mode === "grid" ? placeGridBlock(copy, this.draft.layout.blocks, this.draft.layout.columns) : copy;
    this.mutate((settings) => ({ ...settings, layout: { ...settings.layout, blocks: [...settings.layout.blocks, placed] } }));
  }

  private remove(id: string): void {
    const block = this.draft.layout.blocks.find((candidate) => candidate.id === id);
    if (!block) return;
    const runtime = this.options.getRuntime();
    const needsConfirm = hasBlockUserData(block, runtime) || instanceRuntimeHasUserData(id, runtime);
    if (needsConfirm && !window.confirm(this.options.i18n.t("deleteBlockWithDataConfirm", { title: block.title }))) return;
    if (!needsConfirm && !window.confirm(this.options.i18n.t("deleteBlockConfirm", { title: block.title }))) return;
    if (this.destructiveRuntimeUpdatedAt === null
      && this.saved.layout.blocks.some((candidate) => candidate.id === id)) {
      this.destructiveRuntimeUpdatedAt = runtime.updatedAt;
    }
    this.mutate((settings) => ({
      ...settings,
      layout: {
        ...settings.layout,
        blocks: settings.layout.blocks.filter((candidate) => candidate.id !== id).map((candidate, order) => ({ ...candidate, order })),
      },
    }));
  }

  private add(type: BlockType): void {
    if (!canAddBlock(this.draft, type)) return;
    const descriptor = blockDescriptor(type);
    const row = maxGridRow(this.draft.layout.blocks) + 1;
    let block = createBlockInstance(type, {
      title: this.options.i18n.t(titleKey(type)),
      zone: this.draft.layout.zone,
      row,
      width: descriptor.defaultGridWidth,
      height: descriptor.defaultGridHeight,
      order: this.draft.layout.blocks.length,
      free: {
        x: 24,
        y: Math.max(24, this.draft.layout.blocks.reduce((maximum, candidate) => Math.max(maximum, candidate.free.y + candidate.free.height), 0) + 24),
        width: descriptor.minFreeWidth,
        height: descriptor.minFreeHeight,
      },
    });
    if (this.draft.layout.mode === "grid") block = placeGridBlock(block, this.draft.layout.blocks, this.draft.layout.columns);
    this.mutate((settings) => ({ ...settings, layout: { ...settings.layout, blocks: [...settings.layout.blocks, block] } }));
  }

  private setMode(mode: LayoutMode): void {
    if (this.draft.layout.mode === mode) return;
    this.mutate((settings) => {
      const blocks = mode === "grid"
        ? placeGridBlocks(settings.layout.blocks, settings.layout.columns)
        : settings.layout.blocks;
      return { ...settings, layout: { ...settings.layout, mode, blocks } };
    });
  }

  private setZone(zone: LayoutZone): void {
    if (this.draft.layout.zone === zone) return;
    this.mutate((settings) => {
      const moved = settings.layout.blocks.map((block) => ({ ...block, zone }));
      const blocks = settings.layout.mode === "grid"
        ? placeGridBlocks(moved, settings.layout.columns)
        : moved;
      return { ...settings, layout: { ...settings.layout, zone, blocks } };
    });
  }

  private renderControls(): void {
    const { i18n, toolbarHost, paletteHost } = this.options;
    toolbarHost.replaceChildren();
    paletteHost.replaceChildren();
    toolbarHost.hidden = false;
    if (!this.active) {
      const edit = button(i18n.t("editLayout"), "button button--primary");
      edit.addEventListener("click", () => this.enter());
      toolbarHost.append(edit);
      paletteHost.hidden = true;
      return;
    }

    const mode = select<LayoutMode>(this.draft.layout.mode, [["grid", i18n.t("layoutModeGrid")], ["free", i18n.t("layoutModeFree")]]);
    mode.setAttribute("aria-label", i18n.t("layoutMode"));
    mode.addEventListener("change", () => this.setMode(mode.value as LayoutMode));
    const zone = select<LayoutZone>(this.draft.layout.zone, [["contained", i18n.t("layoutZoneContained")], ["full", i18n.t("layoutZoneFull")]]);
    zone.setAttribute("aria-label", i18n.t("layoutZone"));
    zone.addEventListener("change", () => this.setZone(zone.value as LayoutZone));
    const status = element("span", "editor-toolbar__status", i18n.t("layoutEditorStatus", {
      mode: i18n.t(this.draft.layout.mode === "grid" ? "layoutModeGrid" : "layoutModeFree"),
      zone: i18n.t(this.draft.layout.zone === "contained" ? "layoutZoneContained" : "layoutZoneFull"),
    }));
    const save = button(i18n.t("saveLayout"), "button button--primary");
    save.addEventListener("click", () => this.runAsync(() => this.save()));
    const cancel = button(i18n.t("cancel"), "button button--secondary");
    cancel.addEventListener("click", () => this.cancel());
    toolbarHost.append(status, mode, zone, cancel, save);

    paletteHost.hidden = false;
    const heading = element("h2", "palette__title", i18n.t("blockPalette"));
    const list = element("div", "palette__list");
    for (const descriptor of BLOCK_DESCRIPTORS) {
      const available = canAddBlock(this.draft, descriptor.type);
      const tile = button("", "palette-tile");
      tile.disabled = !available;
      tile.append(
        element("span", "palette-tile__title", i18n.t(descriptor.titleKey)),
        element("span", "palette-tile__description", i18n.t(descriptor.descriptionKey)),
        element("span", "palette-tile__badge", i18n.t(descriptor.repeatable ? "repeatableBlock" : "singletonBlock")),
      );
      if (available) {
        tile.setAttribute("aria-label", i18n.t("addBlockNamed", { title: i18n.t(descriptor.titleKey) }));
        tile.addEventListener("click", () => this.add(descriptor.type));
      } else {
        tile.title = this.draft.layout.blocks.length >= MAX_START_PAGE_BLOCKS
          ? i18n.t("blockCapacityReached", { count: MAX_START_PAGE_BLOCKS })
          : i18n.t("singletonAlreadyAdded");
        tile.setAttribute("aria-label", `${i18n.t(descriptor.titleKey)}. ${tile.title}`);
      }
      list.append(tile);
    }
    paletteHost.append(heading, list);
  }

  private startPointerSession(event: PointerEvent, blockId: string, card: HTMLElement, kind: PointerSession["kind"]): void {
    if (event.button !== 0) return;
    const block = this.draft.layout.blocks.find((candidate) => candidate.id === blockId);
    if (!block) return;
    event.preventDefault();
    event.stopPropagation();
    card.setPointerCapture(event.pointerId);
    this.pointerSession = { pointerId: event.pointerId, blockId, kind, startX: event.clientX, startY: event.clientY, startBlock: cloneBlock(block), card };
    card.classList.add(kind === "move" ? "card--moving" : "card--resizing");
    const move = (moveEvent: PointerEvent): void => this.handlePointerMove(moveEvent);
    const end = (endEvent: PointerEvent): void => {
      if (endEvent.pointerId !== this.pointerSession?.pointerId) return;
      card.removeEventListener("pointermove", move);
      card.removeEventListener("pointerup", end);
      card.removeEventListener("pointercancel", end);
      card.removeEventListener("lostpointercapture", end);
      card.classList.remove("card--moving", "card--resizing");
      this.pointerSession = null;
      this.renderControls();
      this.options.requestRender();
    };
    card.addEventListener("pointermove", move);
    card.addEventListener("pointerup", end);
    card.addEventListener("pointercancel", end);
    card.addEventListener("lostpointercapture", end);
  }

  private handlePointerMove(event: PointerEvent): void {
    const session = this.pointerSession;
    if (!session || event.pointerId !== session.pointerId) return;
    const deltaX = event.clientX - session.startX;
    const deltaY = event.clientY - session.startY;
    const layout = this.draft.layout;
    const gridElement = session.card.parentElement;
    if (!gridElement) return;
    let candidate = cloneBlock(session.startBlock);
    if (layout.mode === "free") {
      if (session.kind === "move") {
        candidate.free.x = Math.max(0, session.startBlock.free.x + deltaX);
        candidate.free.y = Math.max(0, session.startBlock.free.y + deltaY);
      } else {
        const descriptor = blockDescriptor(candidate.type);
        candidate.free.width = Math.max(descriptor.minFreeWidth, session.startBlock.free.width + deltaX);
        candidate.free.height = Math.max(descriptor.minFreeHeight, session.startBlock.free.height + deltaY);
      }
    } else {
      const bounds = gridElement.getBoundingClientRect();
      const columnWidth = Math.max(1, (bounds.width - layout.gap * (layout.columns - 1)) / layout.columns);
      const columnDelta = Math.round(deltaX / (columnWidth + layout.gap));
      const rowDelta = Math.round(deltaY / (layout.rowHeight + layout.gap));
      if (session.kind === "move") {
        candidate.column = session.startBlock.column + columnDelta;
        candidate.row = session.startBlock.row + rowDelta;
      } else {
        candidate.width = session.startBlock.width + columnDelta;
        candidate.height = session.startBlock.height + rowDelta;
      }
      candidate = placeGridBlock(candidate, layout.blocks, layout.columns);
    }
    this.updateBlockWithoutRender(session.blockId, candidate);
    this.dirty = true;
    this.options.previewBlock(session.card, candidate, this.draft);
  }

  private updateBlockWithoutRender(id: string, replacement: BlockInstance): void {
    this.draft.layout.blocks = this.draft.layout.blocks.map((block) => block.id === id ? replacement : block);
    this.draft.layout.profile = "custom";
  }

  private handleCardKeydown(event: KeyboardEvent, id: string): void {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLButtonElement || event.target instanceof HTMLSelectElement) return;
    const block = this.draft.layout.blocks.find((candidate) => candidate.id === id);
    if (!block) return;
    event.preventDefault();
    const directionX = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    const directionY = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    let candidate = cloneBlock(block);
    if (this.draft.layout.mode === "grid") {
      if (event.shiftKey) {
        candidate.width += directionX;
        candidate.height += directionY;
      } else {
        candidate.column += directionX;
        candidate.row += directionY;
      }
      candidate = placeGridBlock(candidate, this.draft.layout.blocks, this.draft.layout.columns);
    } else {
      const step = event.altKey ? 1 : 10;
      if (event.shiftKey) {
        const descriptor = blockDescriptor(candidate.type);
        candidate.free.width = Math.max(descriptor.minFreeWidth, candidate.free.width + directionX * step);
        candidate.free.height = Math.max(descriptor.minFreeHeight, candidate.free.height + directionY * step);
      } else {
        candidate.free.x = Math.max(0, candidate.free.x + directionX * step);
        candidate.free.y = Math.max(0, candidate.free.y + directionY * step);
      }
    }
    this.updateBlock(id, () => candidate);
  }
}
