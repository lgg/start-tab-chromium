import type { I18n } from "../lib/i18n.js";
import type { StartPageRuntimeState, StartPageSettings } from "../lib/start-page-settings.js";

export interface BlockRenderContext {
  i18n: I18n;
  settings: StartPageSettings;
  runtime: StartPageRuntimeState;
  setRuntime: (runtime: StartPageRuntimeState) => Promise<void>;
  requestRender: () => void;
  registerCleanup: (cleanup: () => void) => void;
}

export interface UrlItem {
  title: string;
  url: string;
}
