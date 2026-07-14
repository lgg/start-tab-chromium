import type { I18n } from "../lib/i18n.js";
import type { BlockInstance, StartLink } from "../lib/start-page-settings.js";
import { actionButton, element } from "./block-renderer-common.js";
import type { BlockRenderContext } from "./block-renderer-types.js";

interface IpResult {
  ip: string;
  country: string;
}

interface CacheEntry {
  expiresAt: number;
  promise: Promise<unknown>;
}

const requestCache = new Map<string, CacheEntry>();

function cachedRequest<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const existing = requestCache.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.promise as Promise<T>;
  const promise = loader();
  requestCache.set(key, { expiresAt: Date.now() + ttlMs, promise });
  void promise.catch(() => {
    if (requestCache.get(key)?.promise === promise) requestCache.delete(key);
  });
  return promise;
}

function safeLocale(requested: string, fallback: string): string {
  for (const candidate of [requested.trim(), fallback, "en"]) {
    if (!candidate) continue;
    try {
      return Intl.getCanonicalLocales(candidate)[0] ?? "en";
    } catch {
      // Try the next locale candidate.
    }
  }
  return "en";
}

function localeFor(block: Extract<BlockInstance, { type: "dateTime" }>, i18n: I18n): string {
  return safeLocale(block.config.locale, i18n.locale);
}

function dateParts(date: Date, timeZone: string, locale: string): Record<string, string> {
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    timeZone: timeZone || undefined,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dateFormatter.formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function formatPattern(date: Date, pattern: string, timeZone: string, locale: string): string {
  const parts = dateParts(date, timeZone, locale);
  const replacements: Record<string, string> = {
    dddd: parts.weekday ?? "",
    YYYY: parts.year ?? "",
    MMMM: parts.month ?? "",
    DD: parts.day ?? "",
    HH: parts.hour === "24" ? "00" : parts.hour ?? "",
    mm: parts.minute ?? "",
    ss: parts.second ?? "",
  };
  return Object.entries(replacements)
    .sort(([left], [right]) => right.length - left.length)
    .reduce((result, [token, replacement]) => result.split(token).join(replacement), pattern);
}

export function renderDateTime(
  block: Extract<BlockInstance, { type: "dateTime" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  const time = element("div", "date-time__time");
  const date = element("div", "date-time__date");
  time.style.fontSize = `${block.config.timeFontSize}px`;
  const update = (): void => {
    const now = new Date();
    const locale = localeFor(block, context.i18n);
    if (block.config.mode !== "date") time.textContent = formatPattern(now, block.config.timeFormat, block.config.timeZone, locale);
    if (block.config.mode !== "time") date.textContent = formatPattern(now, block.config.dateFormat, block.config.timeZone, locale);
  };
  if (block.config.mode !== "date") container.append(time);
  if (block.config.mode !== "time") container.append(date);
  update();
  const timer = window.setInterval(update, 1000);
  context.registerCleanup(() => window.clearInterval(timer));
}

export function renderSearch(
  block: Extract<BlockInstance, { type: "search" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  const form = element("form", "search");
  const input = element("input", "input search__input");
  input.type = "search";
  input.placeholder = block.config.placeholder || context.i18n.t("searchPlaceholder");
  input.autocomplete = "off";
  input.setAttribute("aria-label", context.i18n.t("searchPlaceholder"));
  const submit = element("button", "button button--primary", context.i18n.t("searchButton"));
  submit.type = "submit";
  form.append(input, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    const provider = block.config.providers.find((candidate) => candidate.id === block.config.provider)
      ?? block.config.providers[0];
    if (!provider) return;
    location.href = provider.urlTemplate.split("{query}").join(encodeURIComponent(query));
  });
  container.append(form);
}

function parseIpPayload(payload: unknown): IpResult | null {
  if (typeof payload !== "object" || payload === null) return null;
  const source = payload as Record<string, unknown>;
  const ip = [source.ip, source.query, source.address].find((value): value is string => typeof value === "string" && value.length > 0);
  const country = [source.country_name, source.country, source.countryCode, source.country_code]
    .find((value): value is string => typeof value === "string" && value.length > 0) ?? "";
  return ip ? { ip, country } : null;
}

async function fetchIp(endpoint: string): Promise<IpResult> {
  const endpoints = [...new Set([
    endpoint,
    "https://ipapi.co/json/",
    "https://ipwho.is/",
    "https://api.ipify.org?format=json",
  ].filter(Boolean))];
  let lastError: unknown = null;
  for (const candidate of endpoints) {
    try {
      const response = await fetch(candidate, { cache: "no-store" });
      if (!response.ok) throw new Error(`IP provider returned ${response.status}`);
      const parsed = parseIpPayload(await response.json());
      if (parsed) return parsed;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("IP lookup failed");
}

export function renderIp(
  block: Extract<BlockInstance, { type: "ip" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  const detail = element("div", "ip__detail", context.i18n.t("ipLoading"));
  container.append(detail);
  void cachedRequest(`ip:${block.config.endpoint}`, 5 * 60_000, () => fetchIp(block.config.endpoint)).then((result) => {
    if (!detail.isConnected) return;
    detail.textContent = context.i18n.t("ipResult", {
      ip: result.ip || context.i18n.t("ipUnknown"),
      country: result.country || context.i18n.t("ipUnknownCountry"),
    });
  }).catch(() => {
    if (detail.isConnected) detail.textContent = context.i18n.t("ipUnavailable");
  });
}

function pageItems<T>(items: readonly T[], page: number, perPage: number): T[] {
  return items.slice(page * perPage, (page + 1) * perPage);
}

function linkTile(item: StartLink): HTMLAnchorElement {
  const anchor = element("a", "link-tile");
  anchor.href = item.url;
  const icon = element("span", "link-tile__icon", item.icon || item.title.slice(0, 2).toUpperCase());
  icon.setAttribute("aria-hidden", "true");
  const title = element("span", "link-tile__title", item.title);
  anchor.append(icon, title);
  return anchor;
}

export function renderLinkCollection(
  block: Extract<BlockInstance, { type: "links" | "startPinned" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  const config = block.config;
  container.style.setProperty("--link-columns", String(config.columns));
  container.style.setProperty("--link-font-family", config.fontFamily);
  container.style.setProperty("--link-font-size", `${config.fontSize}px`);
  container.style.setProperty("--link-icon-size", `${config.iconSize}px`);
  const perPage = Math.max(1, config.columns * config.rows);
  const totalPages = Math.max(1, Math.ceil(config.items.length / perPage));
  let page = Math.min(context.runtime.linkPages[block.id] ?? 0, totalPages - 1);
  const list = element("div", `links links--${config.pageDirection}`);
  const pager = element("div", "pager");
  const changePage = async (nextPage: number): Promise<void> => {
    const expectedPage = context.runtime.linkPages[block.id] ?? 0;
    page = nextPage;
    context.runtime.linkPages[block.id] = page;
    await context.setRuntime({ kind: "linkPage", instanceId: block.id, page, expectedPage });
    draw();
  };
  const previous = actionButton(context.i18n.t("previousPage"), () => changePage((page - 1 + totalPages) % totalPages), "button button--secondary");
  const next = actionButton(context.i18n.t("nextPage"), () => changePage((page + 1) % totalPages), "button button--secondary");
  const label = element("span", "pager__label");
  const draw = (): void => {
    list.replaceChildren(...pageItems(config.items, page, perPage).map(linkTile));
    label.textContent = context.i18n.t("pageCounter", { page: page + 1, pages: totalPages });
  };
  draw();
  container.append(list);
  if (totalPages > 1) {
    pager.append(previous, label, next);
    container.append(pager);
  }
}
