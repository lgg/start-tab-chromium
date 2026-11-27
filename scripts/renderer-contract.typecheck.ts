// Compile-only regression tests. These assertions have no runtime
// instructions: tsc must reject a contract change, including widening
// a CAS mutation so that its expected value can be omitted.
import type { BlockRenderContext, RuntimeMutation, UrlItem } from "../src/newtab/block-renderer-types.js";
import type { Ack } from "../src/lib/messages.js";
import type { I18n } from "../src/lib/i18n.js";
import type { LocalTask, StartPageRuntimeState, StartPageSettings } from "../src/lib/start-page-settings.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type Reject<T extends false> = T;
type Assignable<A, B> = [A] extends [B] ? true : false;

export type RendererContractChecks = [
  Expect<Equal<RuntimeMutation["kind"], "note" | "tasks" | "linkPage">>,
  Expect<Equal<Extract<RuntimeMutation, { kind: "note" }>, {
    kind: "note"; instanceId: string; value: string; expectedValue: string
  }>>,
  Expect<Equal<Extract<RuntimeMutation, { kind: "tasks" }>, {
    kind: "tasks"; instanceId: string; tasks: LocalTask[]; expectedTasks: LocalTask[]
  }>>,
  Expect<Equal<Extract<RuntimeMutation, { kind: "linkPage" }>, {
    kind: "linkPage"; instanceId: string; page: number; expectedPage: number
  }>>,
  Reject<Assignable<{ kind: "note"; instanceId: string; value: string }, RuntimeMutation>>,
  Reject<Assignable<{ kind: "tasks"; instanceId: string; tasks: LocalTask[] }, RuntimeMutation>>,
  Reject<Assignable<{ kind: "linkPage"; instanceId: string; page: number }, RuntimeMutation>>,
  Reject<Assignable<{ kind: "clock"; instanceId: string }, RuntimeMutation>>,
  Expect<Equal<BlockRenderContext["i18n"], I18n>>,
  Expect<Equal<BlockRenderContext["settings"], StartPageSettings>>,
  Expect<Equal<BlockRenderContext["runtime"], StartPageRuntimeState>>,
  Expect<Equal<Parameters<BlockRenderContext["setRuntime"]>, [mutation: RuntimeMutation]>>,
  Expect<Equal<ReturnType<BlockRenderContext["setRuntime"]>, Promise<Ack>>>,
  Expect<Equal<Parameters<BlockRenderContext["requestRender"]>, []>>,
  Expect<Equal<ReturnType<BlockRenderContext["requestRender"]>, void>>,
  Expect<Equal<Parameters<BlockRenderContext["reportError"]>, [error: unknown]>>,
  Expect<Equal<ReturnType<BlockRenderContext["reportError"]>, void>>,
  Expect<Equal<Parameters<BlockRenderContext["registerCleanup"]>, [cleanup: () => void]>>,
  Expect<Equal<ReturnType<BlockRenderContext["registerCleanup"]>, void>>,
  Reject<Assignable<Omit<BlockRenderContext, "registerCleanup">, BlockRenderContext>>,
  Expect<Equal<keyof UrlItem, "title" | "url">>,
  Expect<Equal<UrlItem["title"], string>>,
  Expect<Equal<UrlItem["url"], string>>,
  Reject<Assignable<{ title: string }, UrlItem>>,
  Reject<Assignable<{ title: string; url: number }, UrlItem>>
];
