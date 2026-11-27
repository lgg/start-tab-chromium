import type { BlockInstance, StartPageSettings } from "./start-page-settings.js";

const TARGET_TYPES = {
  clock: ["timer", "stopwatch", "pomodoro"],
  note: ["note"],
  tasks: ["localTasks"],
  linkPage: ["links", "startPinned"],
} as const;

export type RuntimeMutationTargetKind = keyof typeof TARGET_TYPES;
type RuntimeMutationTarget<K extends RuntimeMutationTargetKind> =
  Extract<BlockInstance, { type: (typeof TARGET_TYPES)[K][number] }>;

function findRuntimeMutationTarget<K extends RuntimeMutationTargetKind>(
  settings: StartPageSettings,
  instanceId: string,
  kind: K,
): RuntimeMutationTarget<K> | undefined {
  const allowed: readonly BlockInstance["type"][] = TARGET_TYPES[kind];
  // Resolve the identity once. A clock action must not perform a second
  // lookup after the mutation target has already been validated.
  const block = settings.layout.blocks.find(candidate => candidate.id === instanceId);
  return block && allowed.includes(block.type) ? block as RuntimeMutationTarget<K> : undefined;
}

export function runtimeMutationTargetExists(
  settings: StartPageSettings,
  instanceId: string,
  kind: RuntimeMutationTargetKind,
): boolean {
  return findRuntimeMutationTarget(settings, instanceId, kind) !== undefined;
}

export function assertRuntimeMutationTarget<K extends RuntimeMutationTargetKind>(
  settings: StartPageSettings,
  instanceId: string,
  kind: K,
): RuntimeMutationTarget<K> {
  const block = findRuntimeMutationTarget(settings, instanceId, kind);
  if (!block) {
    throw new Error("Start Tab block changed or was removed; reload before saving runtime data");
  }
  return block;
}
