import type { StartPageSettings } from "./start-page-settings.js";

export type RuntimeMutationTargetKind = "clock" | "note" | "tasks" | "linkPage";

export function runtimeMutationTargetExists(
  settings: StartPageSettings,
  instanceId: string,
  kind: RuntimeMutationTargetKind,
): boolean {
  const block = settings.layout.blocks.find((candidate) => candidate.id === instanceId);
  if (!block) return false;
  switch (kind) {
    case "clock":
      return block.type === "timer" || block.type === "stopwatch" || block.type === "pomodoro";
    case "note":
      return block.type === "note";
    case "tasks":
      return block.type === "localTasks";
    case "linkPage":
      return block.type === "links" || block.type === "startPinned";
  }
}

export function assertRuntimeMutationTarget(
  settings: StartPageSettings,
  instanceId: string,
  kind: RuntimeMutationTargetKind,
): void {
  if (!runtimeMutationTargetExists(settings, instanceId, kind)) {
    throw new Error("Start Tab block changed or was removed; reload before saving runtime data");
  }
}
