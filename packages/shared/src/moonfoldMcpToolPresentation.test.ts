import { describe, expect, it } from "vite-plus/test";

import {
  MOONFOLD_MCP_TOOL_NAMES,
  resolveMoonfoldMcpSummaryAction,
  resolveMoonfoldMcpToolDefinition,
  resolveMoonfoldMcpToolPresentation,
} from "./moonfoldMcpToolPresentation.ts";

describe("resolveMoonfoldMcpToolPresentation", () => {
  it("recognizes every Moonfold tool across provider prefixes and completion suffixes", () => {
    for (const tool of MOONFOLD_MCP_TOOL_NAMES) {
      const presentation = resolveMoonfoldMcpToolPresentation(tool);
      for (const prefix of [
        "mcp__moonfold__",
        "Moonfold.",
        "moonfold.",
        "moonfold-direct.",
        "mcp__moonfold_direct__",
        "moonfold/",
        "moonfold:",
        "mcp_moonfold_",
        "Moonfold ",
        "moonfold · ",
      ]) {
        expect(resolveMoonfoldMcpToolPresentation(`${prefix}${tool} completed`), tool).toEqual(
          presentation,
        );
      }
      expect(resolveMoonfoldMcpToolPresentation(`mcp__another-server__${tool}`), tool).toBeNull();
    }
  });

  it("matches OpenCode 2's per-thread server names, whose thread ids hold underscores", () => {
    expect(
      resolveMoonfoldMcpToolPresentation("moonfold-thread_opencode2-adapter_delegate_task")
        ?.displayName,
    ).toBe("Delegate a child task");
    expect(
      resolveMoonfoldMcpToolPresentation("moonfold-thread_opencode2-adapter_not_a_tool"),
    ).toBeNull();
  });
});

describe("resolveMoonfoldMcpToolDefinition", () => {
  it("labels an action tool call as the action it ran", () => {
    expect(
      resolveMoonfoldMcpToolDefinition("mcp__moonfold__preview_act", { action: "type" })?.labels,
    ).toEqual(resolveMoonfoldMcpToolDefinition("preview_type")?.labels);
    expect(resolveMoonfoldMcpToolDefinition("moonfold_thread_transfer", { action: "fork" })?.displayName).toBe(
      resolveMoonfoldMcpToolDefinition("moonfold_thread_fork")?.displayName,
    );
    expect(resolveMoonfoldMcpToolDefinition("preview_act", { action: "unknown" })?.labels[2]).toBe(
      "Used",
    );
  });
});

describe("resolveMoonfoldMcpSummaryAction", () => {
  it("summarizes an action tool by the action each call ran", () => {
    expect(resolveMoonfoldMcpSummaryAction("mcp__moonfold__moonfold_queue", { action: "list" })).toBe(
      "queue-list",
    );
    expect(resolveMoonfoldMcpSummaryAction("moonfold_queue", { action: "edit" })).toBe("queue-edit");
    expect(resolveMoonfoldMcpSummaryAction("moonfold_thread_transfer", { action: "status" })).toBe(
      "thread-transfers",
    );
    expect(resolveMoonfoldMcpSummaryAction("moonfold_thread_configure", {})).toBe("thread-configuration");
    expect(resolveMoonfoldMcpSummaryAction("schedule_task", { scheduledTaskId: "task-1" })).toBe(
      "schedule-update",
    );
    expect(resolveMoonfoldMcpSummaryAction("delegate_task", { task: "x" })).toBe("delegate");
  });
});
