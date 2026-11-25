import type { LocalePreference } from "../lib/i18n.js";

export type LocaleReloadDecision = "none" | "defer" | "reload";

/** Once deferred, never automatically reload on a later storage echo:
 * the user must explicitly choose when to leave their current editing session. */
export function localeReloadDecision(loaded: LocalePreference, committed: LocalePreference, protectedWork: boolean, previouslyDeferred: boolean): LocaleReloadDecision {
  if (loaded === committed) return "none";
  return protectedWork || previouslyDeferred ? "defer" : "reload";
}

/** Hidden or removed widgets must not make unsaved note text unreachable. */
export function hiddenDraftIds<T extends { hasUnsaved: boolean }>(
  drafts: Iterable<readonly [string, T]>, visibleIds: ReadonlySet<string>,
): string[] {
  return Array.from(drafts).filter(([id, draft]) => draft.hasUnsaved && !visibleIds.has(id)).map(([id]) => id);
}
