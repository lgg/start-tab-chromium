import { ownValue } from "../lib/dictionary.js";
import { buildSearchUrl } from "../lib/start-page-validation-primitives.js";
import { createDatePartsFormatter, formatDateParts } from "./date-pattern.js";
import type { I18n } from "../lib/i18n.js";
import { blockTitleKey, blockUsesDefaultTitle, type BlockInstance, type StartLink } from "../lib/start-page-settings.js";
import type { HiddenTextDraft } from "./hidden-text-drafts.js";
import { actionButton, element } from "./block-renderer-common.js";
import type { BlockRenderContext } from "./block-renderer-types.js";
import { WidgetRequestCache } from "./widget-request-cache.js";
import { WidgetTextDrafts } from "./widget-text-drafts.js";
import { WidgetWriteSession } from "./versioned-widget-value.js";
import { getStartPageViewSnapshot } from "../lib/start-page-runtime.js";
import { parseIpPayload, type IpResult } from "./provider-payloads.js";
import { fetchWidgetJson } from "./widget-network.js";

const requestCache = new WidgetRequestCache();

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

export function renderDateTime(
  block: Extract<BlockInstance, { type: "dateTime" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  const time = element("div", "date-time__time");
  const date = element("div", "date-time__date");
  time.style.fontSize = `${block.config.timeFontSize}px`;
  const formatParts = createDatePartsFormatter(localeFor(block, context.i18n), block.config.timeZone);
  const update = (): void => {
    const parts = formatParts(new Date());
    if (block.config.mode !== "date") time.textContent = formatDateParts(block.config.timeFormat, parts);
    if (block.config.mode !== "time") date.textContent = formatDateParts(block.config.dateFormat, parts);
  };
  if (block.config.mode !== "date") container.append(time);
  if (block.config.mode !== "time") container.append(date);
  update();
  const timer = window.setInterval(update, 1000);
  context.registerCleanup(() => window.clearInterval(timer));
}

const searchDrafts = new WidgetTextDrafts();

export function hasSearchDrafts(): boolean {
  return searchDrafts.hasDrafts();
}

export function hiddenSearchDrafts(visible: ReadonlySet<string>): HiddenTextDraft[] {
  return searchDrafts.hidden(visible).map(([id, draft]) => ({
    kind: "search", title: draft.title, value: draft.value, pending: false,
    discard: () => searchDrafts.discard(id, draft.value),
  }));
}

export function renderSearch(
  block: Extract<BlockInstance, { type: "search" }>,
  container: HTMLElement,
  context: BlockRenderContext,
): void {
  const form = element("form", "search");
  const input = element("input", "input search__input");
  input.type = "search";
  input.dataset.widgetDraft = `search:${block.id}`;
  input.value = searchDrafts.get(block.id);
  const title = blockUsesDefaultTitle(block) ? context.i18n.t(blockTitleKey(block.type)) : block.title;
  searchDrafts.set(block.id, input.value, title);
  input.addEventListener("input", () => {
    if (form.isConnected) searchDrafts.set(block.id, input.value, title);
  });
  input.placeholder = block.config.placeholder || context.i18n.t("searchPlaceholder");
  input.autocomplete = "off";
  input.setAttribute("aria-label", context.i18n.t("searchPlaceholder"));
  const submit = element("button", "button button--primary", context.i18n.t("searchButton"));
  submit.type = "submit";
  form.append(input, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.isConnected) return;
    const query = input.value.trim();
    if (!query) return;
    const provider = block.config.providers.find((candidate) => candidate.id === block.config.provider)
      ?? block.config.providers[0];
    if (!provider) return;
    const url = buildSearchUrl(provider.urlTemplate, query);
    if (!url) {
      context.reportError(new Error(context.i18n.t("validationInvalidSearchProvider")));
      return;
    }
    try {
      location.href = url;
    } catch (error) {
      context.reportError(error);
    }
  });
  container.append(form);
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
      const parsed = parseIpPayload(await fetchWidgetJson(candidate));
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
  void requestCache.get(`ip:${block.config.endpoint}`, 5 * 60_000, () => fetchIp(block.config.endpoint)).then((result) => {
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

const linkPageSessions = new Map<string, WidgetWriteSession<number>>();

export function pruneLinkPages(retained: ReadonlySet<string>): void {
  for (const [id, session] of linkPageSessions) {
    if (!retained.has(id) && !session.pending) linkPageSessions.delete(id);
  }
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
  const session = linkPageSessions.get(block.id) ?? new WidgetWriteSession<number>();
  linkPageSessions.set(block.id, session);
  session.committed.observe(ownValue(context.runtime.linkPages, block.id) ?? 0, context.runtime.updatedAt);
  const page = (): number => Math.min(session.committed.get(0), totalPages - 1);
  const list = element("div", `links links--${config.pageDirection}`);
  const pager = element("div", "pager");
  const changePage = async (offset: number): Promise<void> => {
    if (session.view !== draw || !session.begin()) return;
    const expectedPage = session.committed.get(0);
    const nextPage = (page() + offset + totalPages) % totalPages;
    draw();
    try {
      const revision = await context.setRuntime({ kind: "linkPage", instanceId: block.id, page: nextPage, expectedPage });
      if (revision !== undefined) session.committed.observe(nextPage, revision);
      else {
        const { runtime } = await getStartPageViewSnapshot();
        session.committed.observe(ownValue(runtime.linkPages, block.id) ?? 0, runtime.updatedAt);
      }
    } finally {
      session.finish();
      session.view?.();
      context.requestRender();
    }
  };
  const previous = actionButton(context.i18n.t("previousPage"), () => changePage(-1), "button button--secondary", context.reportError);
  const next = actionButton(context.i18n.t("nextPage"), () => changePage(1), "button button--secondary", context.reportError);
  const label = element("span", "pager__label");
  const draw = (): void => {
    const current = page();
    previous.disabled = session.pending;
    next.disabled = session.pending;
    list.replaceChildren(...pageItems(config.items, current, perPage).map(linkTile));
    label.textContent = context.i18n.t("pageCounter", { page: current + 1, pages: totalPages });
  };
  session.view = draw;
  context.registerCleanup(() => {
    if (session.view === draw) session.view = undefined;
  });
  draw();
  container.append(list);
  if (totalPages > 1) {
    pager.append(previous, label, next);
    container.append(pager);
  }
}
