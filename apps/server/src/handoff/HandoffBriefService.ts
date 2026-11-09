/**
 * HandoffBriefService - builds the brief a provider receives when a thread moves to it: the
 * thread's log plus the workspace's git state and project instructions at that moment. The
 * preview and the delivery both call `build`, so the user sees what is sent.
 *
 * @module handoff/HandoffBriefService
 */
import {
  type ModelSelection,
  type OrchestrationV2ThreadProjection,
  PROVIDER_DISPLAY_NAMES,
} from "@moonfold/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { buildHandoffBrief, type HandoffBrief, type HandoffReason } from "./handoffBrief.ts";

const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"] as const;
const MAX_INSTRUCTIONS_BYTES = 64 * 1024;
const GIT_OUTPUT_BYTES = 32 * 1024;
const GIT_TIMEOUT_MS = 10_000;

export interface HandoffBriefRequest {
  readonly projection: Pick<
    OrchestrationV2ThreadProjection,
    "turnItems" | "runtimeRequests" | "providerThreads"
  > & {
    readonly thread: Pick<OrchestrationV2ThreadProjection["thread"], "activeProviderThreadId">;
  };
  /** The thread's workspace; null when it has none. */
  readonly cwd: string | null;
  /** The selection the thread is moving from, and to. */
  readonly from: ModelSelection;
  readonly to: ModelSelection;
  readonly reason: HandoffReason;
}

export class HandoffBriefService extends Context.Service<
  HandoffBriefService,
  {
    readonly build: (request: HandoffBriefRequest) => Effect.Effect<HandoffBrief>;
  }
>()("moonfold/handoff/HandoffBriefService") {}

const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const adapters = yield* ProviderAdapterRegistry.ProviderAdapterRegistryV2;

  const label = Effect.fn("HandoffBriefService.label")(function* (selection: ModelSelection) {
    const metadata =
      adapters.getMetadata === undefined
        ? Option.none()
        : yield* Effect.option(adapters.getMetadata(selection.instanceId));
    const name = Option.match(metadata, {
      onNone: () => selection.instanceId as string,
      onSome: (found) => PROVIDER_DISPLAY_NAMES[found.driver] ?? selection.instanceId,
    });
    return `${name} (${selection.model})`;
  });

  // A workspace that is not a repository, or git that fails, leaves that part of the brief out.
  const gitOutput = (cwd: string, operation: string, args: ReadonlyArray<string>) =>
    git
      .execute({
        operation,
        cwd,
        args,
        allowNonZeroExit: true,
        timeoutMs: GIT_TIMEOUT_MS,
        maxOutputBytes: GIT_OUTPUT_BYTES,
        appendTruncationMarker: true,
      })
      .pipe(
        Effect.map((result) => (result.exitCode === 0 ? result.stdout : null)),
        Effect.orElseSucceed(() => null),
      );

  const instructions = Effect.fn("HandoffBriefService.instructions")(function* (cwd: string) {
    for (const file of INSTRUCTION_FILES) {
      const text = yield* fs.readFileString(path.join(cwd, file)).pipe(Effect.option);
      if (Option.isSome(text) && text.value.trim() !== "") {
        return { file, text: text.value.slice(0, MAX_INSTRUCTIONS_BYTES) };
      }
    }
    return null;
  });

  const build = Effect.fn("HandoffBriefService.build")(function* (request: HandoffBriefRequest) {
    const { projection, cwd } = request;
    const gitStatus =
      cwd === null ? null : yield* gitOutput(cwd, "handoff.brief.status", ["status", "--short"]);
    const diffStat =
      cwd === null || gitStatus === null
        ? null
        : yield* gitOutput(cwd, "handoff.brief.diffStat", ["diff", "--stat", "HEAD"]);
    const activeProviderThread = projection.providerThreads.find(
      (thread) => thread.id === projection.thread.activeProviderThreadId,
    );
    return buildHandoffBrief({
      items: projection.turnItems,
      goal: activeProviderThread?.goal ?? null,
      from: yield* label(request.from),
      to: yield* label(request.to),
      reason: request.reason,
      pendingRequests: projection.runtimeRequests.filter((entry) => entry.status === "pending")
        .length,
      gitStatus,
      diffStat,
      instructions: cwd === null ? null : yield* instructions(cwd),
    });
  });

  return HandoffBriefService.of({ build });
});

export const layer = Layer.effect(HandoffBriefService, make);
