/**
 * HandoffService - moves a thread to another provider. `preview` builds what the next provider
 * would be sent, without sending anything; `start` checks the same rules and dispatches the
 * continuation turn on the new provider, whose brief the turn start adds.
 *
 * @module handoff/HandoffService
 */
import {
  CommandId,
  type HandoffBriefInput,
  type HandoffBriefResult,
  HandoffError,
  type HandoffPreview,
  type HandoffPreviewInput,
  type HandoffStartInput,
  handoffAllowsProvider,
  MessageId,
  type ModelSelection,
  type OrchestrationV2ThreadProjection,
  PROVIDER_DISPLAY_NAMES,
  resolveProjectProviderInstanceEnabled,
  type ServerSettings as ServerSettingsValue,
} from "@moonfold/contracts";
import { historicalMessage } from "@moonfold/provider-core/server/handoffBudget";
import { resolveProjectSettings } from "@moonfold/shared/projectSettings";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as RuntimePolicy from "../orchestration-v2/RuntimePolicy.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as HandoffBriefService from "./HandoffBriefService.ts";

/** What the new provider is asked to do; the brief ahead of it says where the task stands. */
export const HANDOFF_CONTINUE_TEXT = "Continue the task from the handoff brief.";

export class HandoffService extends Context.Service<
  HandoffService,
  {
    readonly preview: (input: HandoffPreviewInput) => Effect.Effect<HandoffPreview, HandoffError>;
    readonly start: (input: HandoffStartInput) => Effect.Effect<void, HandoffError>;
    /** The brief a past handoff sent, or null when none was recorded. */
    readonly sentBrief: (
      input: HandoffBriefInput,
    ) => Effect.Effect<HandoffBriefResult, HandoffError>;
  }
>()("moonfold/handoff/HandoffService") {}

const providerName = (selection: ModelSelection) =>
  PROVIDER_DISPLAY_NAMES[selection.instanceId as never] ?? selection.instanceId;

/** The selection the thread's latest run used, or the thread's own when it has not run. */
function currentSelection(projection: Pick<OrchestrationV2ThreadProjection, "thread" | "runs">) {
  return (
    projection.runs.toSorted((a, b) => b.ordinal - a.ordinal)[0]?.modelSelection ??
    projection.thread.modelSelection
  );
}

const ACTIVE_RUN_STATUSES: ReadonlySet<string> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

/** Why a handoff cannot go ahead now, or null when it can. */
function handoffBlockedReason(input: {
  readonly projection: Pick<OrchestrationV2ThreadProjection, "thread" | "runs">;
  readonly settings: ServerSettingsValue;
  readonly target: ModelSelection;
}): string | null {
  const { projection, settings, target } = input;
  const project = resolveProjectSettings(settings, projection.thread.projectId).settings;
  if (projection.thread.deletedAt !== null || projection.thread.archivedAt !== null) {
    return "This thread is archived or deleted.";
  }
  if (target.instanceId === currentSelection(projection).instanceId) {
    return "The thread is already on this provider. Pick another one.";
  }
  if (!handoffAllowsProvider(project.providerHandoff, target.instanceId)) {
    return `This project does not send its threads to ${providerName(target)}. Change it in Settings → Handoff.`;
  }
  if (
    !resolveProjectProviderInstanceEnabled(settings, projection.thread.projectId, target.instanceId)
  ) {
    return `${providerName(target)} is turned off for this project.`;
  }
  const running = projection.runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status));
  if (running) return "Wait for the current turn to finish, or stop it, before handing off.";
  return null;
}

const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const runtimePolicy = yield* RuntimePolicy.RuntimePolicyV2;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const briefs = yield* HandoffBriefService.HandoffBriefService;
  const random = yield* SecureRandom.SecureRandom;

  const fail = (message: string) => new HandoffError({ message });

  const load = Effect.fn("HandoffService.load")(function* (input: HandoffPreviewInput) {
    const projection = yield* projections
      .getThreadProjection(input.threadId)
      .pipe(Effect.mapError(() => fail("This thread could not be read.")));
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError(() => fail("Settings could not be read.")),
    );
    return {
      projection,
      settings,
      blockedReason: handoffBlockedReason({ projection, settings, target: input.target }),
    };
  });

  const preview = Effect.fn("HandoffService.preview")(function* (input: HandoffPreviewInput) {
    const { projection, blockedReason } = yield* load(input);
    const policy = yield* runtimePolicy
      .resolve({ thread: projection.thread, modelSelection: input.target })
      .pipe(Effect.option);
    const from = currentSelection(projection);
    const brief = yield* briefs.build({
      projection,
      cwd: policy._tag === "Some" ? policy.value.cwd : null,
      from,
      to: input.target,
      reason: input.reason,
    });
    return {
      from,
      brief: brief.text,
      redactions: brief.redactions,
      historyMessages: projection.turnItems.filter((item) => historicalMessage(item) !== null)
        .length,
      blockedReason,
    } satisfies HandoffPreview;
  });

  const start = Effect.fn("HandoffService.start")(function* (input: HandoffStartInput) {
    const { blockedReason } = yield* load(input);
    if (blockedReason !== null) return yield* fail(blockedReason);
    const id = yield* random.uuidV4();
    yield* threads
      .dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`handoff:${id}`),
        messageId: MessageId.make(`handoff-message:${id}`),
        threadId: input.threadId,
        text: HANDOFF_CONTINUE_TEXT,
        attachments: [],
        modelSelection: input.target,
        handoffReason: input.reason,
        dispatchMode: { type: "start_immediately" },
        createdBy: "user",
        creationSource: "server",
      })
      .pipe(Effect.mapError((error) => fail(error.message)));
  });

  const sentBrief = Effect.fn("HandoffService.sentBrief")(function* (input: HandoffBriefInput) {
    const projection = yield* projections
      .getThreadProjection(input.threadId)
      .pipe(Effect.mapError(() => fail("This thread could not be read.")));
    return (
      projection.contextHandoffs.find((handoff) => handoff.id === input.contextHandoffId)?.brief ??
      null
    );
  });

  return HandoffService.of({ preview, start, sentBrief });
});

export const layer = Layer.effect(HandoffService, make);
