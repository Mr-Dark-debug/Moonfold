import { CommandId, type OrchestrationV2DomainEvent, type RunId } from "@moonfold/contracts";
import { resolveProjectSettings } from "@moonfold/shared/projectSettings";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

export interface RunTokenTally {
  /** The context size in the last report. */
  readonly last: number;
  /** Tokens the run has added so far; compaction lowers the context, not this. */
  readonly added: number;
}

/**
 * Providers report context size during a turn and cumulative totals only at its end, so a stop
 * that can fire mid-turn counts what the run adds to its context. The first report is the
 * conversation as the run found it, and counts for nothing.
 */
export const tallyRunTokens = (tally: RunTokenTally | undefined, usedTokens: number) =>
  tally === undefined
    ? { last: usedTokens, added: 0 }
    : { last: usedTokens, added: tally.added + Math.max(0, usedTokens - tally.last) };

const SETTLED_RUN_STATUSES = new Set([
  "completed",
  "failed",
  "interrupted",
  "cancelled",
  "rolled_back",
]);

/**
 * Stops a run at the project's token limit (D-60). Each message starts a new run with a fresh
 * allowance, so the limit stops a runaway task without locking the thread.
 */
export class RunTokenLimitReactor extends Context.Service<
  RunTokenLimitReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
  }
>()("moonfold/orchestration-v2/RunTokenLimitReactor") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  // The limit is read once per run: usage reports arrive far too often for a read each.
  const runs = new Map<
    RunId,
    { readonly limit: number | null; tally: RunTokenTally | undefined; stopped: boolean }
  >();

  const readLimit = Effect.fn("readLimit")(function* (event: OrchestrationV2DomainEvent) {
    const { thread } = yield* projections.getThreadRecords(event.threadId, []);
    const settings = yield* serverSettings.getSettings;
    return resolveProjectSettings(settings, thread.projectId).settings.runTokenLimit;
  });

  // Runs for every domain event; most events return before any work is needed.
  const handle: RunTokenLimitReactor["Service"]["handle"] = Effect.fnUntraced(
    function* (event) {
      if (event.type === "run.updated") {
        if (SETTLED_RUN_STATUSES.has(event.payload.status)) runs.delete(event.payload.id);
        return;
      }
      if (event.type !== "provider-turn.updated" || event.runId === undefined) return;
      const usage = event.payload.tokenUsage;
      // A subagent's turn has no attempt of its own; its parent's run carries the stop.
      if (usage === undefined || event.payload.runAttemptId === null) return;
      if (event.payload.status !== "running") return;

      const runId = event.runId;
      let run = runs.get(runId);
      if (run === undefined) {
        run = { limit: yield* readLimit(event), tally: undefined, stopped: false };
        runs.set(runId, run);
      }
      run.tally = tallyRunTokens(run.tally, usage.usedTokens);
      if (run.limit === null || run.stopped || run.tally.added < run.limit) return;

      run.stopped = true;
      yield* engine.dispatch({
        type: "run.interrupt",
        commandId: CommandId.make(`server:run-token-limit:${runId}`),
        threadId: event.threadId,
        runId,
        reason: `Stopped at the token limit of ${run.limit.toLocaleString("en-US")} tokens for one run. Send a message to continue.`,
        holdQueue: true,
      });
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("stopping a run at its token limit failed", {
            threadId: event.threadId,
            cause,
          }),
        ),
      ),
  );

  const start: RunTokenLimitReactor["Service"]["start"] = () =>
    forkParked(
      Stream.runForEach(engine.streamDomainEvents, handle).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("run token limit event stream failed", { cause }),
        ),
      ),
    );

  return { start, handle } satisfies RunTokenLimitReactor["Service"];
});

export const layer = Layer.effect(RunTokenLimitReactor, make);
