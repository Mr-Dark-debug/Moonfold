import { describe, expect, it } from "vite-plus/test";

import { AuthOrchestrationOperateScope, AuthSettingsWriteScope } from "./auth.ts";
import { clientRpcRequiredScopes } from "./clientRpcPermissions.ts";
import { WS_METHODS } from "./rpc.ts";

describe("clientRpcRequiredScopes", () => {
  it("lets operate access answer once but needs settings access to save a lasting rule", () => {
    for (const method of [WS_METHODS.computerUseAnswer, WS_METHODS.browserSitesAnswer]) {
      expect(clientRpcRequiredScopes(method, { id: "r1", answer: "allow_thread" })).toEqual([
        AuthOrchestrationOperateScope,
      ]);
      expect(clientRpcRequiredScopes(method, { id: "r1", answer: "always_allow" })).toEqual([
        AuthOrchestrationOperateScope,
        AuthSettingsWriteScope,
      ]);
    }
    expect(
      clientRpcRequiredScopes(WS_METHODS.browserSitesAnswer, { id: "r1", answer: "always_block" }),
    ).toContain(AuthSettingsWriteScope);
  });

  it("needs operate access to answer an agent's question", () => {
    expect(
      clientRpcRequiredScopes(WS_METHODS.questionsAnswerRequest, {
        threadId: "thread-1",
        turnItemId: "turn-item-1",
        answer: { type: "dismiss" },
      }),
    ).toEqual([AuthOrchestrationOperateScope]);
  });
});
