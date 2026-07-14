import { DATA_REVISION_KEY, markStartTabDataChanged } from "./data-revision.js";
import {
  DEFAULT_SETTINGS,
  cloneSettings,
} from "./start-page-defaults.js";
import {
  LEGACY_INSTANCE_RUNTIME_KEY,
  START_PAGE_RUNTIME_KEY,
  normalizeRuntimeState,
  reconcileClockAlarmsForRuntime,
} from "./start-page-runtime.js";
import {
  START_PAGE_MIGRATION_REPORT_KEY,
  START_PAGE_SETTINGS_KEY,
  isFutureStartPageSchema,
  normalizeStartPageSettings,
  type StartPageSettings,
} from "./start-page-settings.js";
import { withStorageLock } from "./storage-lock.js";

const ONBOARDING_KEY = "startPageOnboarding";

const RESET_STORAGE_KEYS = [
  START_PAGE_SETTINGS_KEY,
  START_PAGE_RUNTIME_KEY,
  LEGACY_INSTANCE_RUNTIME_KEY,
  START_PAGE_MIGRATION_REPORT_KEY,
  ONBOARDING_KEY,
  DATA_REVISION_KEY,
] as const;

function resetSettings(raw: unknown, now: number): StartPageSettings {
  const previous = isFutureStartPageSchema(raw) ? null : normalizeStartPageSettings(raw);
  const updatedAt = Math.max(now, (previous?.updatedAt ?? 0) + 1);
  const settings = cloneSettings(DEFAULT_SETTINGS);
  settings.updatedAt = updatedAt;
  settings.layout.blocks = settings.layout.blocks.map((block) => ({
    ...block,
    createdAt: updatedAt,
    updatedAt,
  }));
  return settings;
}

function runtimeFromStorage(storage: Record<string, unknown>) {
  const settings = normalizeStartPageSettings(storage[START_PAGE_SETTINGS_KEY]);
  return normalizeRuntimeState(
    storage[START_PAGE_RUNTIME_KEY],
    settings,
    storage[LEGACY_INSTANCE_RUNTIME_KEY],
  );
}

function absentKeys(storage: Record<string, unknown>): string[] {
  return RESET_STORAGE_KEYS.filter((key) => !Object.prototype.hasOwnProperty.call(storage, key));
}

/** Reset settings and all per-instance runtime in one rollback-safe cross-context transaction. */
export async function resetStartPageData(): Promise<StartPageSettings> {
  return withStorageLock("data-write", async () => {
    const previous = await chrome.storage.local.get([...RESET_STORAGE_KEYS]);
    const settings = resetSettings(previous[START_PAGE_SETTINGS_KEY], Date.now());
    const runtime = {
      ...normalizeRuntimeState(undefined, settings),
      updatedAt: settings.updatedAt,
    };

    try {
      await chrome.storage.local.set({
        [START_PAGE_SETTINGS_KEY]: settings,
        [START_PAGE_RUNTIME_KEY]: runtime,
      });
      await chrome.storage.local.remove([
        LEGACY_INSTANCE_RUNTIME_KEY,
        START_PAGE_MIGRATION_REPORT_KEY,
        ONBOARDING_KEY,
      ]);
      await reconcileClockAlarmsForRuntime(runtime);
      await markStartTabDataChanged(settings.updatedAt);
      return settings;
    } catch (error) {
      const absent = absentKeys(previous);
      if (absent.length > 0) await chrome.storage.local.remove(absent);
      await chrome.storage.local.set(previous);
      await reconcileClockAlarmsForRuntime(runtimeFromStorage(previous));
      throw error;
    }
  });
}
