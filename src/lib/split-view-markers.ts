export const SPLIT_VIEW_MARKERS = [
  "split-view",
  "split_view",
  "splitview",
  "side-by-side",
  "sidebyside",
  "side_panel",
  "side-panel",
  "tab-picker",
  "tab_picker",
  "tabpicker",
  "select-tab",
  "select_tab",
  "selecttab",
] as const;

export function containsSplitViewMarker(value: unknown): boolean {
  const normalized = String(value ?? "").toLowerCase();
  return SPLIT_VIEW_MARKERS.some((marker) => normalized.includes(marker));
}
