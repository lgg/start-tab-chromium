import { jsonContentEqual } from "../lib/json-content.js";
import type { StartPageRuntimeState } from "../lib/start-page-runtime.js";

export interface StartPageStorageChangeFlags {
  settings: boolean;
  runtime: boolean;
  focusStats: boolean;
}

export interface StartPageStorageChangePlan {
  announceIgnoredSettings: boolean;
  refreshState: boolean;
}

/**
 * Preserve an in-progress layout draft while still refreshing independent
 * runtime/statistics state delivered in the same storage change event.
 */
export function planStartPageStorageChange(
  hasUnsavedSettings: boolean,
  changes: StartPageStorageChangeFlags,
): StartPageStorageChangePlan {
  const announceIgnoredSettings = hasUnsavedSettings && changes.settings;
  return {
    announceIgnoredSettings,
    refreshState: changes.runtime || changes.focusStats || (changes.settings && !hasUnsavedSettings),
  };
}

/** Compare runtime user-visible content while ignoring the monotonic revision timestamp and all object key insertion order. */
export function sameRuntimeContent(left: StartPageRuntimeState, right: StartPageRuntimeState): boolean {
  return jsonContentEqual(
    { clocks: left.clocks, notes: left.notes, tasks: left.tasks, linkPages: left.linkPages },
    { clocks: right.clocks, notes: right.notes, tasks: right.tasks, linkPages: right.linkPages },
  );
}
