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

function sortedEntries<T>(record: Readonly<Record<string, T>>): Array<[string, T]> {
  return Object.keys(record)
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
    .map((key) => [key, record[key] as T]);
}

/** Compare runtime user-visible content while ignoring the monotonic revision timestamp and dictionary insertion order. */
export function sameRuntimeContent(left: StartPageRuntimeState, right: StartPageRuntimeState): boolean {
  return JSON.stringify([
    sortedEntries(left.clocks),
    sortedEntries(left.notes),
    sortedEntries(left.tasks),
    sortedEntries(left.linkPages),
  ]) === JSON.stringify([
    sortedEntries(right.clocks),
    sortedEntries(right.notes),
    sortedEntries(right.tasks),
    sortedEntries(right.linkPages),
  ]);
}
