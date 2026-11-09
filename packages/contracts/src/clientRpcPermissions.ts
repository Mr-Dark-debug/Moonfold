import * as Schema from "effect/Schema";
import { GitPreparePullRequestThreadInput, GitRunStackedActionInput } from "./git.ts";
import {
  AuthAccessWriteScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthPreviewOperateScope,
  AuthProvidersManageScope,
  AuthSettingsWriteScope,
  AuthSourceControlWriteScope,
  AuthTerminalOperateScope,
  type AuthEnvironmentScope,
} from "./auth.ts";
import { ORCHESTRATION_V2_WS_METHODS } from "./orchestrationV2.ts";
import { WS_METHODS } from "./rpc.ts";

/** Incremental client enforcement; the server still authorizes every request. */
export const CLIENT_GUARDED_RPC_SCOPES = {
  [WS_METHODS.previewClose]: AuthPreviewOperateScope,
  // Stopping a server signals its processes, as closing a terminal does.
  [WS_METHODS.previewStopLocalServer]: AuthTerminalOperateScope,
  [WS_METHODS.serverRunStorageCleanup]: AuthSettingsWriteScope,
  // Instruction files steer every agent run, so writing one is a settings change.
  [WS_METHODS.agentInstructionsWrite]: AuthSettingsWriteScope,
  // A side question runs the thread's model, like starting a turn.
  [WS_METHODS.threadsAskSideQuestion]: AuthOrchestrationOperateScope,
  // Endpoint checks exist to configure exports, so they need the same grant as saving them.
  [WS_METHODS.serverCheckOtlpEndpoint]: AuthSettingsWriteScope,
  [WS_METHODS.serverRefreshProviders]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsRunAction]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsUpdate]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsComment]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsUpdateComment]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsSubmitReview]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsReplyToThread]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsSetThreadResolution]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsSetReaction]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsSetFilesViewed]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsRequestReviewers]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsSetLabels]: AuthSourceControlWriteScope,
  // Writing a guide runs a model on this environment's providers, which reading one does not.
  [WS_METHODS.pullRequestsGenerateReviewGuide]: AuthOrchestrationOperateScope,
  [WS_METHODS.projectsCreateFromThread]: AuthOrchestrationOperateScope,
  [WS_METHODS.sourceControlCloneRepository]: AuthSourceControlWriteScope,
  [WS_METHODS.sourceControlPublishRepository]: AuthSourceControlWriteScope,
  [WS_METHODS.sourceControlStar]: AuthSourceControlWriteScope,
  // Signing in replaces the server's GitHub credential, as saving a token in Settings does.
  [WS_METHODS.sourceControlSignInStart]: AuthSettingsWriteScope,
  [WS_METHODS.sourceControlSignInWait]: AuthSettingsWriteScope,
  [WS_METHODS.sourceControlSignInCancel]: AuthSettingsWriteScope,
  [WS_METHODS.projectCloneStart]: AuthSourceControlWriteScope,
  [WS_METHODS.projectCloneCancel]: AuthSourceControlWriteScope,
  [WS_METHODS.projectCloneRetry]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsPull]: AuthSourceControlWriteScope,
  [WS_METHODS.gitRunStackedAction]: AuthSourceControlWriteScope,
  [WS_METHODS.gitPreparePullRequestThread]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsCreateWorktree]: AuthSourceControlWriteScope,
  // Moving a thread's checkout creates or merges branches and moves uncommitted work.
  [WS_METHODS.threadsMoveToWorktree]: AuthSourceControlWriteScope,
  [WS_METHODS.threadsReturnToProject]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsRemoveWorktree]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsCreateRef]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsSwitchRef]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsInit]: AuthSourceControlWriteScope,

  // Starts an agent session on this environment that can read its logs and database.
  [WS_METHODS.serverPrepareTriage]: AuthOrchestrationOperateScope,
  [WS_METHODS.scheduledTasksUpsert]: AuthOrchestrationOperateScope,
  [WS_METHODS.scheduledTasksSetEnabled]: AuthOrchestrationOperateScope,
  [WS_METHODS.scheduledTasksDelete]: AuthOrchestrationOperateScope,
  [WS_METHODS.scheduledTasksRunNow]: AuthOrchestrationOperateScope,
  [WS_METHODS.scheduledTasksRotateWebhookToken]: AuthOrchestrationOperateScope,
  [ORCHESTRATION_V2_WS_METHODS.stopWorkflow]: AuthOrchestrationOperateScope,
  // Plugins bring skills and MCP servers that run programs on the environment's machine.
  [WS_METHODS.pluginsInstall]: AuthProvidersManageScope,
  [WS_METHODS.pluginsUpdate]: AuthProvidersManageScope,
  [WS_METHODS.pluginsSetEnabled]: AuthProvidersManageScope,
  [WS_METHODS.pluginsRemove]: AuthProvidersManageScope,
  // Memories steer every agent run, like instruction files.
  [WS_METHODS.memoriesUpsert]: AuthSettingsWriteScope,
  [WS_METHODS.memoriesDelete]: AuthSettingsWriteScope,
  [WS_METHODS.memoriesSetEnabled]: AuthSettingsWriteScope,
  [WS_METHODS.memoriesSetThreadOptOut]: AuthOrchestrationOperateScope,
  [WS_METHODS.handoffStart]: AuthOrchestrationOperateScope,
  // Site rules decide what agents may do on the web.
  [WS_METHODS.browserSitesSetRule]: AuthSettingsWriteScope,
  [WS_METHODS.browserSitesRemoveRule]: AuthSettingsWriteScope,
  [WS_METHODS.browserSitesSetDefaults]: AuthSettingsWriteScope,
  [WS_METHODS.browserSitesAnswer]: AuthOrchestrationOperateScope,
  // Computer use operates this machine's apps.
  [WS_METHODS.computerUseSetEnabled]: AuthSettingsWriteScope,
  [WS_METHODS.computerUseRemoveApp]: AuthSettingsWriteScope,
  [WS_METHODS.computerUseClearLog]: AuthSettingsWriteScope,
  [WS_METHODS.computerUseAnswer]: AuthOrchestrationOperateScope,
  [WS_METHODS.computerUseStop]: AuthOrchestrationOperateScope,
  // An answer steers the agent's run, like a message to it.
  [WS_METHODS.questionsAnswerRequest]: AuthOrchestrationOperateScope,
  // Force stop kills agent processes, as Stop on a terminal does.
  [ORCHESTRATION_V2_WS_METHODS.forceStopThread]: AuthOrchestrationOperateScope,
  // A guest link hands thread access to someone outside, like a pairing link.
  [WS_METHODS.guestShareCreate]: AuthAccessWriteScope,
  [WS_METHODS.peerLinksLink]: AuthAccessWriteScope,
  [WS_METHODS.peerLinksUnlink]: AuthAccessWriteScope,
  // A link lets every agent here reach the other environment: Settings' bar.
  [WS_METHODS.peerLinksAnswerRequest]: AuthAccessWriteScope,
} as const;
export type ClientGuardedRpcTag = keyof typeof CLIENT_GUARDED_RPC_SCOPES;

const decodePrepareThread = Schema.decodeUnknownSync(GitPreparePullRequestThreadInput);
const decodeStackedAction = Schema.decodeUnknownSync(GitRunStackedActionInput);

export function clientRpcRequiredScopes(
  method: string,
  input: unknown,
): readonly AuthEnvironmentScope[] {
  // An "always" answer saves a lasting rule, which is a settings change; answering once is not.
  if (
    (method === WS_METHODS.computerUseAnswer || method === WS_METHODS.browserSitesAnswer) &&
    typeof input === "object" &&
    input !== null &&
    "answer" in input &&
    typeof input.answer === "string" &&
    input.answer.startsWith("always_")
  ) {
    return [AuthOrchestrationOperateScope, AuthSettingsWriteScope];
  }
  if (method === WS_METHODS.gitPreparePullRequestThread && input !== undefined) {
    const payload = decodePrepareThread(input);
    if (payload.mode === "worktree" && payload.threadId !== undefined)
      return [AuthSourceControlWriteScope, AuthOrchestrationOperateScope];
  }
  if (method === WS_METHODS.gitRunStackedAction && input !== undefined) {
    const payload = decodeStackedAction(input);
    if (
      payload.threadId !== undefined &&
      (payload.action === "create_pr" || payload.action === "commit_push_pr")
    )
      return [AuthSourceControlWriteScope, AuthOrchestrationReadScope];
  }
  return Object.hasOwn(CLIENT_GUARDED_RPC_SCOPES, method)
    ? [CLIENT_GUARDED_RPC_SCOPES[method as ClientGuardedRpcTag]]
    : [];
}
