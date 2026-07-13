import type { BlockInstance } from "../lib/start-page-settings.js";
import type { BlockRenderContext } from "./block-renderer-types.js";
import { renderBrowserPinned, renderCommands, renderGoogleCalendar, renderRecent, renderStats, renderWeather } from "./block-renderers-integrations.js";
import { renderClock, renderLocalTasks, renderNote } from "./block-renderers-runtime.js";
import { renderDateTime, renderIp, renderLinkCollection, renderSearch } from "./block-renderers-static.js";

export type { BlockRenderContext } from "./block-renderer-types.js";

export function renderBlockContent(block: BlockInstance, container: HTMLElement, context: BlockRenderContext): void {
  switch (block.type) {
    case "dateTime": renderDateTime(block, container, context); break;
    case "search": renderSearch(block, container, context); break;
    case "ip": renderIp(block, container, context); break;
    case "links":
    case "startPinned": renderLinkCollection(block, container, context); break;
    case "timer":
    case "stopwatch":
    case "pomodoro": renderClock(block, container, context); break;
    case "note": renderNote(block, container, context); break;
    case "localTasks": renderLocalTasks(block, container, context); break;
    case "googleCalendar": renderGoogleCalendar(block, container, context); break;
    case "weather": renderWeather(block, container, context); break;
    case "commands": renderCommands(container, context); break;
    case "recent": renderRecent(block, container, context); break;
    case "browserPinned": renderBrowserPinned(container, context); break;
    case "stats": renderStats(container, context); break;
  }
}
