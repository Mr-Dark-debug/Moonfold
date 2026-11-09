import type { OrchestrationV2DomainEvent } from "@moonfold/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

/**
 * Archiving a thread in Moonfold archives the provider's own copy too, and
 * unarchiving restores it, so the provider's other clients (its CLI or app)
 * agree with Moonfold. Runs after the archive event commits; a provider that
 * cannot be reached keeps its copy as it was, and the Moonfold archive stands.
 */
export class ProviderThreadArchiveSync extends Context.Service<
  ProviderThreadArchiveSync,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
  }
>()("moonfold/orchestration-v2/ProviderThreadArchiveSync") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const providerInstances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;

  // Runs for every domain event; most events return before any work is needed.
  const handle: ProviderThreadArchiveSync["Service"]["handle"] = Effect.fnUntraced(
    function* (event) {
      if (event.type !== "thread.archived" && event.type !== "thread.unarchived") return;
      const archived = event.type === "thread.archived";
      const { providerThreads } = yield* projections.getThreadRecords(event.threadId, [
        "providerThreads",
      ]);
      for (const providerThread of providerThreads) {
        const nativeThreadId = providerThread.nativeThreadRef?.nativeId;
        if (nativeThreadId == null) continue;
        const instance = yield* providerInstances.getInstance(providerThread.providerInstanceId);
        if (instance?.nativeConfig === undefined || !instance.enabled) continue;
        yield* instance.nativeConfig.setThreadArchived({ nativeThreadId, archived }).pipe(
          Effect.catch((error) =>
            Effect.logWarning("syncing archive state to the provider failed", {
              threadId: event.threadId,
              providerThreadId: providerThread.id,
              archived,
              detail: error.detail,
            }),
          ),
        );
      }
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("syncing archive state to the provider failed", {
            threadId: event.threadId,
            cause,
          }),
        ),
      ),
  );

  const start: ProviderThreadArchiveSync["Service"]["start"] = () =>
    forkParked(
      Stream.runForEach(engine.streamDomainEvents, handle).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("provider archive sync event stream failed", { cause }),
        ),
      ),
    );

  return { start, handle } satisfies ProviderThreadArchiveSync["Service"];
});

export const layer = Layer.effect(ProviderThreadArchiveSync, make);
