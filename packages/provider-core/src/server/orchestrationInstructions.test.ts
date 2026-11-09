import { assert, describe, it } from "@effect/vitest";

import {
  MOONFOLD_DEVICE_TOOL_INSTRUCTIONS,
  MOONFOLD_DEVICE_TOOL_INSTRUCTIONS_WITH_TOOL_SEARCH,
  MOONFOLD_ORCHESTRATION_INSTRUCTIONS,
  moonfoldAcpPromptWithInstructions,
  moonfoldOrchestrationPrompt,
  moonfoldOrchestrationSystemPrompt,
} from "./orchestrationInstructions.ts";

describe("Moonfold device instructions", () => {
  it("route device work through device_open and give Claude the line that loads the tools", () => {
    for (const intent of ["`device_list`", "`device_open`", "`agent-device`", "ssh", "`hostId`"]) {
      assert.include(MOONFOLD_DEVICE_TOOL_INSTRUCTIONS, intent);
    }
    assert.notInclude(MOONFOLD_DEVICE_TOOL_INSTRUCTIONS, "ToolSearch");
    const loadLine =
      " Load them with ToolSearch `select:mcp__moonfold__device_list,mcp__moonfold__device_open,mcp__moonfold__device_screenshot,mcp__moonfold__device_close`.";
    assert.include(MOONFOLD_DEVICE_TOOL_INSTRUCTIONS_WITH_TOOL_SEARCH, loadLine);
    assert.equal(
      MOONFOLD_DEVICE_TOOL_INSTRUCTIONS_WITH_TOOL_SEARCH.replace(loadLine, ""),
      MOONFOLD_DEVICE_TOOL_INSTRUCTIONS,
    );
  });

  it("open the app before the returned command's snapshots, screenshots and input", () => {
    assert.include(
      MOONFOLD_DEVICE_TOOL_INSTRUCTIONS,
      "its snapshots, screenshots and input need `open <app>` first,",
    );
  });

  it("keep the failure rule from taking over or closing a session another thread holds", () => {
    // agent-device's DEVICE_IN_USE advice is to rerun with the owner's --session or close it first.
    assert.include(
      MOONFOLD_DEVICE_TOOL_INSTRUCTIONS,
      "follow its advice once, but never reuse or close another session; if it still fails,",
    );
  });

  it("reach OpenCode and Cursor only when the session holds device access", () => {
    assert.include(
      moonfoldOrchestrationSystemPrompt(true, true),
      MOONFOLD_DEVICE_TOOL_INSTRUCTIONS,
    );
    assert.notInclude(moonfoldOrchestrationSystemPrompt(true, false), "## Moonfold devices");
    assert.isUndefined(moonfoldOrchestrationSystemPrompt(false, true));

    const firstRun = (hasDeviceTools: boolean) =>
      moonfoldOrchestrationPrompt({
        prompt: "Check the login screen.",
        hasMoonfoldMcp: true,
        hasDeviceTools,
        orchestrationDelivered: false,
        deviceInstructionsDelivered: false,
      });
    assert.include(firstRun(true), MOONFOLD_DEVICE_TOOL_INSTRUCTIONS);
    assert.notInclude(firstRun(false), "## Moonfold devices");

    const laterRun = (deviceInstructionsDelivered: boolean) =>
      moonfoldOrchestrationPrompt({
        prompt: "Check the login screen.",
        hasMoonfoldMcp: true,
        hasDeviceTools: true,
        orchestrationDelivered: true,
        deviceInstructionsDelivered,
      });
    assert.include(laterRun(false), MOONFOLD_DEVICE_TOOL_INSTRUCTIONS);
    assert.notInclude(laterRun(false), MOONFOLD_ORCHESTRATION_INSTRUCTIONS.trim());
    assert.equal(laterRun(true), "Check the login screen.");
  });

  it("reach ACP agents again when device access changes mid-thread", () => {
    const state = {
      interactionMode: "default",
      hasMoonfoldMcp: true,
      hasDeviceTools: false,
    } as const;
    const withDevices = moonfoldAcpPromptWithInstructions({
      prompt: "Check the login screen.",
      state: { ...state, hasDeviceTools: true },
      previousState: state,
    });
    assert.include(withDevices, MOONFOLD_DEVICE_TOOL_INSTRUCTIONS);
    assert.equal(
      moonfoldAcpPromptWithInstructions({ prompt: "Again.", state, previousState: state }),
      "Again.",
    );
    assert.notInclude(
      moonfoldAcpPromptWithInstructions({ prompt: "Hi.", state }),
      "## Moonfold devices",
    );
  });
});
