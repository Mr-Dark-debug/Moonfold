/**
 * HandoffWorker - in `auto` mode, moves a thread whose turn stopped at a usage limit to the first
 * available provider in the fallback order. It reads only persisted state and keys each move by
 * the stopped run, so a restart or second sweep never moves a thread twice for one stop.
 *
 * @module handoff/HandoffWorker
 */
import {
  CommandId,
  MessageId,
  type ModelSelection,
  nextHandoffTarget,
  type OrchestrationV2ThreadProjection,
  resolveProjectProviderInstanceEnabled,
  type ServerSettings as ServerSettingsValue,
} from "@moonfold/contracts";
import { latestRootProviderFailure } from "@moonfold/shared/orchestrationV2ThreadError";
import { resolveProjectSettings } from "@moonfold/shared/projectSettings";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ServerSettings from "../serverSettings.ts";
import { HANDOFF_CONTINUE_TEXT } from "./HandoffService.ts";

type Projection = Pick<OrchestrationV2ThreadProjection, "thread" | "runs" | "turnItems">;

/**
 * Provider instances this thread last saw stop at a usage limit whose reset (when known) is still
 * ahead, so a fallback never sends the thread straight back to a provider that cannot run it.
 */
export function limitedInstances(projection: Projection, nowMs: number): ReadonlySet<string> {
  const limited = new Set<string>();
  const latestByInstance = new Map<string, OrchestrationV2ThreadProjection["runs"][number]>();
  for (const run of projection.runs) {
    const previous = latestByInstance.get(run.modelSelection.instanceId);
    if (previous === undefined || run.ordinal > previous.ordinal) {
      latestByInstance.set(run.modelSelection.instanceId, run);
    }
  }
  for (const [instanceId, run] of latestByInstance) {
    const failure = latestRootProviderFailure(run, projection.turnItems);
    if (failure?.class !== "usage_limit") continue;
    const resetAt = failure.resetAt;
    if (resetAt == null || Date.parse(resetAt) > nowMs) limited.add(instanceId);
  }
  return limited;
}

/**
 * The continuation an `auto` handoff dispatches for a thread whose latest run stopped at a usage
 * limit, or null when it should stay put (ask mode, nothing to fall back to, or already moved).
 */
export function autoHandoffCommand(input: {
  readonly projection: Projection;
  readonly settings: ServerSettingsValue;
  readonly nowMs: number;
}) {
  const { projection, settings } = input;
  const project = resolveProjectSettings(settings, projection.thread.projectId).settings;
  if (project.providerHandoff.mode !== "auto") return null;
  const latest = projection.runs.toSorted((a, b) => b.ordinal - a.ordinal)[0];
  if (latest === undefined) return null;
  if (latestRootProviderFailure(latest, projection.turnItems)?.class !== "usage_limit") return null;
  const limited = limitedInstances(projection, input.nowMs);
  const target = nextHandoffTarget({
    settings: project.providerHandoff,
    current: latest.modelSelection,
    isAvailable: (selection: ModelSelection) =>
      !limited.has(selection.instanceId) &&
      resolveProjectProviderInstanceEnabled(
        settings,
        projection.thread.projectId,
        selection.instanceId,
      ),
  });
  if (target === null) return null;
  return {
    type: "message.dispatch" as const,
    // One move per stopped run: a second sweep replays this command's receipt.
    commandId: CommandId.make(`handoff-auto:${latest.id}`),
    messageId: MessageId.make(`handoff-auto:${latest.id}`),
    threadId: projection.thread.id,
    text: HANDOFF_CONTINUE_TEXT,
    attachments: [],
    modelSelection: target,
    handoffReason: "automatic" as const,
    dispatchMode: { type: "start_immediately" as const },
    createdBy: "user" as const,
    creationSource: "server" as const,
  };
}

const makeSweep = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  return Effect.fn("HandoffWorker.sweep")(function* () {
    const settings = yield* settingsService.getSettings;
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    for (const { threadId, projectId } of yield* projections.getUsageLimitedThreads()) {
      // Most projects ask first; only an automatic one needs the whole thread read.
      if (resolveProjectSettings(settings, projectId).settings.providerHandoff.mode !== "auto") {
        continue;
      }
      const projection = yield* projections.getThreadProjection(threadId);
      const command = autoHandoffCommand({ projection, settings, nowMs });
      if (command === null) continue;
      yield* threads
        .dispatch(command)
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("handoff.auto.dispatch-failed", { threadId, cause }),
          ),
        );
    }
  });
});

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sweep = yield* makeSweep;
    const scheduler = yield* Scheduler.Scheduler;
    yield* scheduler.register("provider-handoff", sweep());
  }),
);
