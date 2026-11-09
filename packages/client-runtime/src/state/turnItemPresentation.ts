import {
  ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
} from "@moonfold/contracts";

import type { ThreadStructureTurnItem } from "./models.ts";

const WORKSPACE_PREPARATION_INPUT = "Preparing workspace";

export function turnItemIsWorkspacePreparation(item: OrchestrationV2TurnItem): boolean {
  return (
    (item.type === "command_execution" && item.input === WORKSPACE_PREPARATION_INPUT) ||
    (item.type === "error" &&
      item.status === "cancelled" &&
      item.failure.code === ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE)
  );
}

export function workspacePreparationRetryRunIds(
  runs: ReadonlyArray<Pick<OrchestrationV2Run, "id" | "status" | "workspacePreparation">>,
  items: ReadonlyArray<ThreadStructureTurnItem>,
): ReadonlySet<OrchestrationV2Run["id"]> {
  const failedRuns = new Set(
    runs.flatMap((run) =>
      run.status === "failed" && run.workspacePreparation !== undefined ? [run.id] : [],
    ),
  );
  const retryable = new Set<OrchestrationV2Run["id"]>();
  if (failedRuns.size === 0) return retryable;
  for (const item of items) {
    if (
      item.type === "error" &&
      item.status === "failed" &&
      item.failure.code === ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE &&
      item.runId !== null &&
      failedRuns.has(item.runId)
    )
      retryable.add(item.runId);
  }
  return retryable;
}

/**
 * The thread's latest run when it failed and sending its message again can help. A workspace
 * preparation failure has its own retry, and a usage limit fails again until it resets, so
 * neither is offered. Returns null when a later run exists or the latest one did not fail.
 */
export function retryableFailedRun(
  runs: ReadonlyArray<Pick<OrchestrationV2Run, "id" | "ordinal" | "status" | "userMessageId">>,
  items: ReadonlyArray<ThreadStructureTurnItem>,
): Pick<OrchestrationV2Run, "id" | "userMessageId"> | null {
  const latest = runs.reduce<(typeof runs)[number] | null>(
    (current, run) => (current === null || run.ordinal > current.ordinal ? run : current),
    null,
  );
  if (latest === null || latest.status !== "failed") return null;
  const failure = items.find(
    (item): item is Extract<ThreadStructureTurnItem, { type: "error" }> =>
      item.type === "error" && item.status === "failed" && item.runId === latest.id,
  );
  if (
    failure?.failure.class === "usage_limit" ||
    failure?.failure.code === ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE
  ) {
    return null;
  }
  return { id: latest.id, userMessageId: latest.userMessageId };
}
