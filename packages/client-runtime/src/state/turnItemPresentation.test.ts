import {
  MessageId,
  ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
} from "@moonfold/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  retryableFailedRun,
  turnItemIsWorkspacePreparation,
  workspacePreparationRetryRunIds,
} from "./turnItemPresentation.ts";

function command(input: string): OrchestrationV2TurnItem {
  const now = DateTime.makeUnsafe("2026-08-03T00:00:00.000Z");
  return {
    id: TurnItemId.make("item-command"),
    threadId: ThreadId.make("thread-1"),
    runId: RunId.make("run-1"),
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed",
    title: "Workspace ready",
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    type: "command_execution",
    input,
    output: "Workspace preparation completed.",
    exitCode: 0,
  };
}

function preparationFailure(
  status: OrchestrationV2TurnItem["status"],
  code: string | null = ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE,
): OrchestrationV2TurnItem {
  const {
    input: _input,
    output: _output,
    exitCode: _exitCode,
    ...base
  } = command("") as Extract<OrchestrationV2TurnItem, { type: "command_execution" }>;
  return {
    ...base,
    id: TurnItemId.make("item-error"),
    status,
    title: "Workspace preparation failed",
    type: "error",
    failure: { class: "validation_error", message: "fetch failed", code, retryable: false },
  };
}

const worktree = { type: "worktree", baseRef: "main" } as const;
function run(
  status: OrchestrationV2Run["status"],
  workspacePreparation?: typeof worktree,
): Pick<OrchestrationV2Run, "id" | "status" | "workspacePreparation"> {
  return {
    id: RunId.make("run-1"),
    status,
    ...(workspacePreparation === undefined ? {} : { workspacePreparation }),
  };
}

describe("turnItemIsWorkspacePreparation", () => {
  it("hides a preparation failure only once a retry cancelled it", () => {
    expect(turnItemIsWorkspacePreparation(preparationFailure("failed"))).toBe(false);
    expect(turnItemIsWorkspacePreparation(preparationFailure("cancelled"))).toBe(true);
    expect(turnItemIsWorkspacePreparation(preparationFailure("cancelled", null))).toBe(false);
  });
});

describe("workspacePreparationRetryRunIds", () => {
  it("offers a retry while the run still ends in its failed preparation", () => {
    const failure = [preparationFailure("failed")];
    expect([...workspacePreparationRetryRunIds([run("failed", worktree)], failure)]).toEqual([
      RunId.make("run-1"),
    ]);
    expect(workspacePreparationRetryRunIds([run("preparing", worktree)], failure).size).toBe(0);
    expect(workspacePreparationRetryRunIds([run("failed")], failure).size).toBe(0);
    expect(
      workspacePreparationRetryRunIds(
        [run("failed", worktree)],
        [preparationFailure("failed", "provider_crashed")],
      ).size,
    ).toBe(0);
  });
});

describe("retryableFailedRun", () => {
  const run = (id: string, ordinal: number, status: OrchestrationV2Run["status"]) => ({
    id: RunId.make(id),
    ordinal,
    status,
    userMessageId: MessageId.make(`message-${id}`),
  });
  const failure = (failureClass: string, code: string | null = null): OrchestrationV2TurnItem => {
    const item = preparationFailure("failed", code) as Extract<
      OrchestrationV2TurnItem,
      { type: "error" }
    >;
    return {
      ...item,
      failure: { ...item.failure, class: failureClass as never },
    };
  };

  it("offers the latest run's message again when that run failed", () => {
    expect(
      retryableFailedRun(
        [run("run-1", 1, "failed"), run("run-0", 0, "completed")],
        [failure("provider_error")],
      ),
    ).toEqual({ id: RunId.make("run-1"), userMessageId: MessageId.make("message-run-1") });
  });

  it("offers nothing after a later run, a success, a usage limit or a preparation failure", () => {
    expect(
      retryableFailedRun([run("run-1", 1, "failed"), run("run-2", 2, "running")], []),
    ).toBeNull();
    expect(retryableFailedRun([run("run-1", 1, "completed")], [])).toBeNull();
    expect(retryableFailedRun([run("run-1", 1, "failed")], [failure("usage_limit")])).toBeNull();
    expect(
      retryableFailedRun(
        [run("run-1", 1, "failed")],
        [failure("validation_error", ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE)],
      ),
    ).toBeNull();
  });
});
