import type { I18n } from "../lib/i18n.js";
import type { LocalTask, StartPageRuntimeState, StartPageSettings } from "../lib/start-page-settings.js";

export type RuntimeMutation =
  | { kind: "note"; instanceId: string; value: string; expectedValue: string }
  | { kind: "tasks"; instanceId: string; tasks: LocalTask[]; expectedTasks: LocalTask[] }
  | { kind: "linkPage"; instanceId: string; page: number; expectedPage: number };

export interface BlockRenderContext {
  i18n: I18n;
  settings: StartPageSettings;
  runtime: StartPageRuntimeState;
  setRuntime: (mutation: RuntimeMutation) => Promise<void>;
  requestRender: () => void;
  reportError: (error: unknown) => void;
  registerCleanup: (cleanup: () => void) => void;
}

export interface UrlItem {
  title: string;
  url: string;
}
