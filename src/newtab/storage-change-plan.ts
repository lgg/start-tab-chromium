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
