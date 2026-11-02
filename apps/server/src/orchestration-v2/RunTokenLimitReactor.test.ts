import {
  DEFAULT_SERVER_SETTINGS,
  EventId,
  type OrchestrationV2DomainEvent,
  ProjectId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  NodeId,
  ThreadId,
} from "@moonfold/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ServerSettings from "../serverSettings.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import {
  layer as reactorLayer,
  RunTokenLimitReactor,
  tallyRunTokens,
} from "./RunTokenLimitReactor.ts";

const threadId = ThreadId.make("thread-1");
const runId = RunId.make("run-1");
const now = DateTime.makeUnsafe("2026-11-02T00:00:00.000Z");

let eventOrdinal = 0;
const usageEvent = (usedTokens: number, runAttempt: string | null = "attempt-1") =>
  ({
    id: EventId.make(`event-${(eventOrdinal += 1)}`),
    threadId,
    runId,
    occurredAt: now,
    type: "provider-turn.updated",
    payload: {
      id: ProviderTurnId.make("turn-1"),
      providerThreadId: ProviderThreadId.make("provider-thread-1"),
      nodeId: NodeId.make("node-1"),
      runAttemptId: runAttempt === null ? null : RunAttemptId.make(runAttempt),
      nativeTurnRef: null,
      ordinal: 1,
      status: "running",
      startedAt: now,
      completedAt: null,
      tokenUsage: { usedTokens, updatedAt: "2026-11-02T00:00:00.000Z" },
    },
  }) as OrchestrationV2DomainEvent;

const withReactor = <A, E>(
  runTokenLimit: number | null,
  use: (input: {
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
    readonly dispatched: Ref.Ref<ReadonlyArray<unknown>>;
  }) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const dispatched = yield* Ref.make<ReadonlyArray<unknown>>([]);
    const settings = { ...DEFAULT_SERVER_SETTINGS, runTokenLimit };
    const layer = reactorLayer.pipe(
      Layer.provide(
        Layer.mock(Orchestrator.OrchestratorV2)({
          dispatch: (command) =>
            Ref.update(dispatched, (commands) => [...commands, command]).pipe(
              Effect.as({ sequence: 1 } as never),
            ),
        }),
      ),
      Layer.provide(
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThreadRecords: () =>
            Effect.succeed({ thread: { projectId: ProjectId.make("project-1") } } as never),
        }),
      ),
      Layer.provide(
        Layer.mock(ServerSettings.ServerSettingsService)({
          getSettings: Effect.succeed(settings),
        }),
      ),
    );
    return yield* Effect.gen(function* () {
      const reactor = yield* RunTokenLimitReactor;
      return yield* use({ handle: reactor.handle, dispatched });
    }).pipe(Effect.provide(layer));
  });

describe("tallyRunTokens", () => {
  it("does not charge a run for the conversation it started from", () => {
    assert.deepStrictEqual(tallyRunTokens(undefined, 150_000), { last: 150_000, added: 0 });
  });

  it("keeps what a run added across a compaction", () => {
    const grown = tallyRunTokens({ last: 150_000, added: 0 }, 190_000);
    const compacted = tallyRunTokens(grown, 40_000);
    const after = tallyRunTokens(compacted, 45_000);
    assert.strictEqual(after.added, 45_000);
  });
});

describe("RunTokenLimitReactor", () => {
  it.effect("interrupts once, when the run passes the limit", () =>
    withReactor(10_000, ({ handle, dispatched }) =>
      Effect.gen(function* () {
        yield* handle(usageEvent(100_000));
        yield* handle(usageEvent(109_999));
        assert.lengthOf(yield* Ref.get(dispatched), 0);

        yield* handle(usageEvent(110_000));
        yield* handle(usageEvent(120_000));
        const commands = yield* Ref.get(dispatched);
        assert.lengthOf(commands, 1);
        assert.deepInclude(commands[0] as object, {
          type: "run.interrupt",
          threadId,
          runId,
          holdQueue: true,
        });
      }),
    ),
  );

  it.effect("leaves runs alone when no limit is set", () =>
    withReactor(null, ({ handle, dispatched }) =>
      Effect.gen(function* () {
        yield* handle(usageEvent(100_000));
        yield* handle(usageEvent(900_000));
        assert.lengthOf(yield* Ref.get(dispatched), 0);
      }),
    ),
  );

  it.effect("does not count a subagent's turns", () =>
    withReactor(10_000, ({ handle, dispatched }) =>
      Effect.gen(function* () {
        yield* handle(usageEvent(100_000, null));
        yield* handle(usageEvent(900_000, null));
        assert.lengthOf(yield* Ref.get(dispatched), 0);
      }),
    ),
  );
});
