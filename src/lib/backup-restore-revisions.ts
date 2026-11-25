import { DATA_REVISION_SCHEMA_VERSION } from "./data-revision.js";
import { isRecord } from "./start-page-validation-primitives.js";
import type { StartPageSettings, StartPageRuntimeState } from "./start-page-types.js";

/**
 * Imported timestamps describe another snapshot, not the local optimistic
 * edit tokens. Reusing them can resurrect an old token (ABA) or accept a
 * stale dialog when two devices used the same millisecond.
 * Canonical backup checksums deliberately exclude these generated stamps.
 */
export function restampRestoredState(
  incomingSettings: StartPageSettings,
  incomingRuntime: StartPageRuntimeState,
  previousSettings: StartPageSettings,
  previousRuntime: StartPageRuntimeState,
  rawRevision: unknown,
  now = Date.now(),
): { settings: StartPageSettings; runtime: StartPageRuntimeState; revision: number } {
  let floor = Math.max(previousSettings.updatedAt, previousRuntime.updatedAt, 0);
  if (isRecord(rawRevision) && rawRevision.version === DATA_REVISION_SCHEMA_VERSION
    && typeof rawRevision.updatedAt === "number" && Number.isSafeInteger(rawRevision.updatedAt)) {
    floor = Math.max(floor, rawRevision.updatedAt);
  }
  for (const entity of [...previousSettings.layout.blocks, ...previousSettings.themes.customThemes]) {
    floor = Math.max(floor, entity.updatedAt);
  }
  for (const tasks of Object.values(previousRuntime.tasks)) {
    for (const task of tasks) floor = Math.max(floor, task.updatedAt);
  }
  const revision = Math.max(now, floor + 1);
  if (!Number.isSafeInteger(revision) || revision >= Number.MAX_SAFE_INTEGER || revision <= floor) {
    throw new Error("Start Tab restore revision exceeds the safe integer range");
  }
  return {
    revision,
    settings: {
      ...incomingSettings,
      updatedAt: revision,
      layout: { ...incomingSettings.layout, blocks: incomingSettings.layout.blocks.map((block) => ({ ...block, updatedAt: revision })) },
      themes: { ...incomingSettings.themes, customThemes: incomingSettings.themes.customThemes.map((theme) => ({ ...theme, updatedAt: revision })) },
    },
    runtime: {
      ...incomingRuntime,
      updatedAt: revision,
      tasks: Object.fromEntries(Object.entries(incomingRuntime.tasks)
        .map(([id, tasks]) => [id, tasks.map((task) => ({ ...task, updatedAt: revision }))])),
    },
  };
}
