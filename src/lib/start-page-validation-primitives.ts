import { createDictionary } from "./dictionary.js";
import { BLOCK_TYPES, type BlockType, type SearchProvider, type StartLink, type ValidationIssue } from "./start-page-types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isBlockType(value: unknown): value is BlockType {
  return typeof value === "string" && (BLOCK_TYPES as readonly string[]).includes(value);
}

export function stringValue(value: unknown, fallback: string, maxLength = 500): string {
  return typeof value === "string" ? value.slice(0, maxLength) : fallback;
}

export function trimmedString(value: unknown, fallback: string, maxLength = 500): string {
  return stringValue(value, fallback, maxLength).trim();
}

export function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function finiteInteger(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(finiteNumber(value, fallback, min, max));
}

export function timestampValue(value: unknown, fallback = 0): number {
  return finiteInteger(value, fallback, 0, Number.MAX_SAFE_INTEGER);
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

export function safeWebUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

export function safeWebUrlTemplate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.includes("{query}")) return null;
  return safeWebUrl(trimmed.split("{query}").join("start-tab-query")) ? trimmed : null;
}

export function safeGradient(value: unknown, fallback: string): string {
  const candidate = trimmedString(value, fallback, 1000);
  return /^(linear-gradient|radial-gradient|conic-gradient)\(/i.test(candidate) ? candidate : fallback;
}

export function safeCssToken(value: unknown, fallback: string, maxLength = 300): string {
  const candidate = trimmedString(value, fallback, maxLength);
  return candidate && !/[<>]/.test(candidate) ? candidate : fallback;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableItemId(prefix: string, index: number, seed: string): string {
  return `${prefix}-${index + 1}-${stableHash(seed)}`;
}

export function normalizeStartLinks(value: unknown, fallback: readonly StartLink[], path: string, issues: ValidationIssue[]): StartLink[] {
  if (!Array.isArray(value)) return fallback.map((item) => ({ ...item }));
  const result: StartLink[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      issues.push({ path: `${path}[${index}]`, messageKey: "validationInvalidLink" });
      continue;
    }
    const url = safeWebUrl(stringValue(item.url, ""));
    const title = trimmedString(item.title, "", 100);
    if (!url || !title) {
      issues.push({ path: `${path}[${index}]`, messageKey: "validationInvalidLink" });
      continue;
    }
    result.push({
      id: trimmedString(item.id, stableItemId("link", index, `${title}|${url}`), 150),
      icon: trimmedString(item.icon, title.slice(0, 2).toUpperCase(), 20),
      title,
      url,
    });
  }
  return result;
}

export function normalizeSearchProviders(value: unknown, fallback: readonly SearchProvider[], path: string, issues: ValidationIssue[]): SearchProvider[] {
  const source = Array.isArray(value) ? value : fallback;
  const result: SearchProvider[] = [];
  const seen = new Set<string>();
  for (const [index, item] of source.entries()) {
    if (!isRecord(item)) {
      issues.push({ path: `${path}[${index}]`, messageKey: "validationInvalidSearchProvider" });
      continue;
    }
    const id = trimmedString(item.id, stableItemId("provider", index, String(item.title ?? "provider")), 100);
    const title = trimmedString(item.title, id, 100);
    const urlTemplate = safeWebUrlTemplate(stringValue(item.urlTemplate, ""));
    if (!id || !title || !urlTemplate || seen.has(id)) {
      issues.push({ path: `${path}[${index}]`, messageKey: "validationInvalidSearchProvider" });
      continue;
    }
    seen.add(id);
    result.push({ id, title, urlTemplate });
  }
  return result.length > 0 ? result : fallback.map((provider) => ({ ...provider }));
}

export function normalizeDomainMinutes(value: unknown): Record<string, number> {
  const result = createDictionary<number>();
  if (!isRecord(value)) return result;
  for (const [domain, minutes] of Object.entries(value)) {
    const normalizedDomain = domain.trim().toLowerCase();
    if (!normalizedDomain || typeof minutes !== "number" || !Number.isFinite(minutes)) continue;
    result[normalizedDomain] = Math.min(1440, Math.max(0, minutes));
  }
  return result;
}

export function normalizeTimeZone(value: unknown, fallback: string, path: string, issues: ValidationIssue[]): string {
  const timeZone = trimmedString(value, fallback, 100);
  if (!timeZone) return "";
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(0);
    return timeZone;
  } catch {
    issues.push({ path, messageKey: "validationInvalidTimeZone" });
    return fallback;
  }
}

export function legacyConfigSource(type: BlockType, root: Record<string, unknown>): Record<string, unknown> {
  const source = root[type];
  if (isRecord(source)) return source;
  if (type === "timer" || type === "stopwatch" || type === "pomodoro") return isRecord(root.timers) ? root.timers : {};
  if (type === "startPinned") return isRecord(root.startPinned) ? root.startPinned : {};
  return {};
}
