import { actionButton, element } from "./block-renderer-common.js";
import type { BlockRenderContext } from "./block-renderer-types.js";

export interface HiddenTextDraft {
  kind: "task" | "search";
  title: string;
  value: string;
  pending: boolean;
  discard: () => boolean;
}

/** Hidden widget drafts remain in memory until their widget returns or the
 * user explicitly discards them. Never submit a draft to a different widget. */
export function renderHiddenTextDrafts(host: HTMLElement, drafts: readonly HiddenTextDraft[], context: BlockRenderContext): void {
  host.hidden = drafts.length === 0;
  if (drafts.length === 0) { host.replaceChildren(); return; }
  const heading = element("h2", "", context.i18n.t("hiddenWidgetTextDrafts"));
  const description = element("p", "", context.i18n.t("hiddenNoteDraftsDescription"));
  const entries = drafts.map((draft) => {
    const row = element("div", "hidden-note-draft");
    const kind = context.i18n.t(draft.kind === "task" ? "hiddenTaskDraft" : "hiddenSearchDraft");
    const title = element("strong", "", draft.title ? kind + " — " + draft.title : kind);
    const text = element("textarea", "note");
    text.readOnly = true;
    text.value = draft.value;
    text.setAttribute("aria-label", title.textContent ?? kind);
    const select = actionButton(context.i18n.t("hiddenNoteSelect"), () => {
      if (!row.isConnected) return;
      text.focus();
      text.select();
    }, "button button--secondary", context.reportError);
    const discard = actionButton(context.i18n.t("hiddenNoteDiscard"), () => {
      if (!row.isConnected || !window.confirm(context.i18n.t("hiddenWidgetDiscardConfirm"))) return;
      if (draft.discard()) context.requestRender();
    }, "button button--secondary", context.reportError);
    discard.disabled = draft.pending;
    const actions = element("div", "note-save-status__controls");
    actions.append(select, discard);
    row.append(title, text, actions);
    return row;
  });
  host.replaceChildren(heading, description, ...entries);
}
