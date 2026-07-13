import { markStartTabDataChanged } from "./data-revision.js";
import { DEFAULT_SETTINGS, cloneSettings } from "./start-page-defaults.js";
import {
  isFutureStartPageSchema,
  isRecord,
  normalizeStartPageSettings,
  normalizeStartPageSettingsWithReport,
  validateStartPageSettings,
} from "./start-page-validation-v2.js";
import type { MigrationReport, StartPageSettings, ValidationIssue } from "./start-page-types.js";

export const START_PAGE_SETTINGS_KEY = "startPageSettings";
export const START_PAGE_MIGRATION_REPORT_KEY = "startPageMigrationReport";

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function withBlockTimestamps(previous: StartPageSettings | null, next: StartPageSettings, now: number): StartPageSettings {
  const previousById = new Map(previous?.layout.blocks.map((block) => [block.id, block]) ?? []);
  return {
    ...next,
    updatedAt: now,
    layout: {
      ...next.layout,
      blocks: next.layout.blocks.map((block) => {
        const prior = previousById.get(block.id);
        if (!prior) return { ...block, createdAt: block.createdAt || now, updatedAt: now };
        const unchanged = jsonEqual({ ...prior, updatedAt: 0 }, { ...block, updatedAt: 0 });
        return {
          ...block,
          createdAt: prior.createdAt || block.createdAt || now,
          updatedAt: unchanged ? prior.updatedAt : now,
        };
      }),
    },
  };
}

async function readRawSettings(): Promise<unknown> {
  const items = await chrome.storage.local.get(START_PAGE_SETTINGS_KEY);
  return items[START_PAGE_SETTINGS_KEY];
}

export async function getStartPageSettings(): Promise<StartPageSettings> {
  const raw = await readRawSettings();
  const { settings, report } = normalizeStartPageSettingsWithReport(raw);
  if (isFutureStartPageSchema(raw)) {
    await chrome.storage.local.set({ [START_PAGE_MIGRATION_REPORT_KEY]: report });
    return settings;
  }
  if (jsonEqual(raw, settings)) return settings;
  const stamped = withBlockTimestamps(null, settings, Date.now());
  await chrome.storage.local.set({
    [START_PAGE_SETTINGS_KEY]: stamped,
    [START_PAGE_MIGRATION_REPORT_KEY]: report,
  });
  await markStartTabDataChanged(stamped.updatedAt);
  return stamped;
}

export async function getStartPageMigrationReport(): Promise<MigrationReport | null> {
  const items = await chrome.storage.local.get(START_PAGE_MIGRATION_REPORT_KEY);
  const value = items[START_PAGE_MIGRATION_REPORT_KEY];
  if (!isRecord(value) || typeof value.fromVersion !== "number" || typeof value.toVersion !== "number") return null;
  const issues = Array.isArray(value.issues)
    ? value.issues.filter(isRecord).flatMap((issue) => typeof issue.path === "string" && typeof issue.reason === "string" ? [{ path: issue.path, reason: issue.reason }] : [])
    : [];
  return {
    fromVersion: value.fromVersion,
    toVersion: value.toVersion,
    migratedBlocks: typeof value.migratedBlocks === "number" ? value.migratedBlocks : 0,
    skippedBlocks: typeof value.skippedBlocks === "number" ? value.skippedBlocks : 0,
    issues,
  };
}

export async function setStartPageSettings(value: StartPageSettings): Promise<ValidationIssue[]> {
  const previous = normalizeStartPageSettings(await readRawSettings());
  const validation = validateStartPageSettings(value);
  const stamped = withBlockTimestamps(previous, validation.value, Date.now());
  await chrome.storage.local.set({ [START_PAGE_SETTINGS_KEY]: stamped });
  await markStartTabDataChanged(stamped.updatedAt);
  return validation.issues;
}

export async function updateStartPageSettings(
  updater: (current: StartPageSettings) => StartPageSettings,
): Promise<{ settings: StartPageSettings; issues: ValidationIssue[] }> {
  const current = await getStartPageSettings();
  const candidate = updater(cloneSettings(current));
  const issues = await setStartPageSettings(candidate);
  return { settings: await getStartPageSettings(), issues };
}

export async function resetStartPageSettings(): Promise<StartPageSettings> {
  const now = Date.now();
  const settings = withBlockTimestamps(null, cloneSettings(DEFAULT_SETTINGS), now);
  await chrome.storage.local.set({ [START_PAGE_SETTINGS_KEY]: settings });
  await markStartTabDataChanged(now);
  return settings;
}
