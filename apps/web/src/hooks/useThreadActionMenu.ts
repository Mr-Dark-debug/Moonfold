import { scopeProjectRef } from "@moonfold/client-runtime/environment";
import { requestCustomSnooze } from "../components/CustomSnoozeDialog";
import { openGuestShareDialog } from "../components/chat/guestShareDialogState";
import { requestHandoff } from "../components/HandoffDialog";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@moonfold/client-runtime/state/runtime";
import { canSnooze, effectiveSnoozed } from "@moonfold/client-runtime/state/thread-settled";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  type ScopedThreadRef,
  type ThreadId,
} from "@moonfold/contracts";
import { useRouter } from "@tanstack/react-router";

import { pickSnoozePreset, resolveSnoozePresets } from "../components/Sidebar.snooze";
import {
  buildThreadActionMenuItems,
  threadActionRequiresOperate,
  threadWorkspaceKind,
  type ThreadActionMenuId,
} from "../components/threadActionMenu.logic";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { copyThreadReference } from "../lib/copyThreadReference";
import { threadChipCopyTarget } from "@moonfold/client-runtime/thread-reference";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { readEnvironmentScope } from "../state/session";
import {
  readEnvironmentServerConfigLoaded,
  readEnvironmentSupportsAutoSettleOptOut,
  readThreadShell,
  readEnvironmentPromptProfileChoices,
  useProjects,
} from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { readLocalApi } from "../localApi";
import { configuredHostedAppUrl } from "../hostedPairing";
import {
  deriveLogicalProjectKeyFromSettings,
  derivePhysicalProjectKey,
  selectProjectGroupingSettings,
} from "@moonfold/client-runtime/state/project-grouping";
import { buildPhysicalToLogicalProjectKeyMap } from "../sidebarProjectGrouping";
import { threadRuntimeCanArchive } from "@moonfold/client-runtime/state/models";
import { useCopyToClipboard } from "./useCopyToClipboard";
import { useNewThreadHandler } from "./useHandleNewThread";
import { useClientSettings } from "./useSettings";
import { canTurnThreadIntoProject, useThreadActions } from "./useThreadActions";
import { useThreadWorkspaceTransfer } from "./useThreadWorkspaceTransfer";
import { useThreadMemoryChoice } from "./useThreadMemoryChoice";
import { canPopOutThreads, openThreadInNewWindow } from "../threadPopout";

function failureToast(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

export function useThreadActionMenu(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly projectCwd: string | null;
  readonly onStartRename: () => void;
  readonly onFind?: ((threadRef: ScopedThreadRef) => void) | undefined;
  readonly canShareWithGuest: boolean;
}) {
  const { threadRef, projectCwd, onStartRename, onFind, canShareWithGuest } = input;
  const router = useRouter();
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const logicalProjectKeyByPhysicalKey = buildPhysicalToLogicalProjectKeyMap({
    projects,
    settings: projectGroupingSettings,
    primaryEnvironmentId,
  });
  const {
    settleThread,
    unsettleThread,
    snoozeThread,
    unsnoozeThread,
    pinThread,
    confirmAndUnpinThread,
    setThreadAutoSettle,
    archiveThread,
    deleteThread,
    markThreadUnread,
    turnThreadIntoProject,
  } = useThreadActions();
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const handleNewThread = useNewThreadHandler();
  const { moveToWorktree, returnToProject } = useThreadWorkspaceTransfer();
  const threadMemoryChoice = useThreadMemoryChoice();
  const confirmThreadDelete = useClientSettings((s) => s.confirmThreadDelete);
  const confirmThreadArchive = useClientSettings((s) => s.confirmThreadArchive);
  const timestampFormat = useClientSettings((s) => s.timestampFormat);
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path: string }>({
    onCopy: ({ path }) => {
      toastManager.add({ type: "success", title: "Path copied", description: path });
    },
    onError: (error) => failureToast("Failed to copy path", error),
  });
  const { copyToClipboard: copyBranchToClipboard } = useCopyToClipboard<{ branch: string }>({
    target: "branch name",
    onCopy: ({ branch }) => {
      toastManager.add({ type: "success", title: "Branch copied", description: branch });
    },
    onError: (error) => failureToast("Failed to copy branch", error),
  });
  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{ threadId: ThreadId }>({
    onCopy: ({ threadId }) => {
      toastManager.add({ type: "success", title: "Thread ID copied", description: threadId });
    },
    onError: (error) => failureToast("Failed to copy thread ID", error),
  });

  const openMenu = (position: { x: number; y: number }) => {
    if (threadRef === null) return;
    void (async () => {
      const api = readLocalApi();
      if (!api) return;
      const thread = readThreadShell(threadRef);
      if (!thread) return;
      const now = new Date();
      const configLoaded = readEnvironmentServerConfigLoaded(threadRef.environmentId);
      const supports = {
        settlement: configLoaded,
        autoSettleOptOut: readEnvironmentSupportsAutoSettleOptOut(threadRef.environmentId),
        snooze: configLoaded,
        pinning: configLoaded,
        titleRegeneration: configLoaded,
      };
      const isRegeneratingTitle = thread.titleRegeneration != null;
      const snoozePresets = resolveSnoozePresets(now, timestampFormat, threadRef.environmentId);
      const memoriesOptedOut = await threadMemoryChoice.read(threadRef);
      const promptProfileChoices = readEnvironmentPromptProfileChoices(
        threadRef.environmentId,
        thread.projectId,
      );
      const items = buildThreadActionMenuItems({
        canOperate: readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope),
        canFind: onFind !== undefined,
        branch: thread.branch ?? null,
        projectFilter: null,
        isPinned: thread.pinnedAt != null,
        isSettled: supports.settlement && thread.settledOverride === "settled",
        autoSettleEnabled: thread.autoSettleDisabledAt == null,
        memoriesOptedOut,
        promptProfile:
          promptProfileChoices === null
            ? null
            : { ...promptProfileChoices, threadProfileId: thread.promptProfileId ?? null },
        isSnoozed: supports.snooze && effectiveSnoozed(thread, { now: now.toISOString() }),
        canSnoozeNow: canSnooze(thread, { now: now.toISOString() }),
        isRegeneratingTitle,
        isRunning: !threadRuntimeCanArchive(thread.runtime),
        canOpenInWindow: canPopOutThreads(),
        workspace: threadWorkspaceKind(
          { worktreePath: thread.worktreePath ?? null, branch: thread.branch ?? null },
          readEnvironmentScope(threadRef.environmentId, AuthSourceControlWriteScope),
        ),
        supports,
        snoozePresets,
        canShareWithGuest,
        canTurnIntoProject: canTurnThreadIntoProject(threadRef),
      });
      const clicked = await settlePromise(() => api.contextMenu.show(items, position));
      if (clicked._tag === "Failure" || clicked.value === null) return;
      const action: ThreadActionMenuId = clicked.value;
      if (
        threadActionRequiresOperate(action) &&
        !readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope)
      ) {
        failureToast(
          "Thread action unavailable",
          new Error("This connection cannot change threads."),
        );
        return;
      }
      if (action.startsWith("snooze:")) {
        const preset =
          action === "snooze:custom"
            ? await requestCustomSnooze()
            : pickSnoozePreset(
                snoozePresets,
                action.slice("snooze:".length),
                timestampFormat,
                threadRef.environmentId,
              );
        if (!preset) return;
        const result = await snoozeThread(threadRef, preset.snoozedUntil);
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          failureToast("Failed to snooze thread", squashAtomCommandFailure(result));
        }
        return;
      }
      if (action.startsWith("prompt-profile:")) {
        // An empty id is "Default": the thread follows the environment or project default again.
        const profileId = action.slice("prompt-profile:".length);
        const result = await updateThreadMetadata({
          environmentId: threadRef.environmentId,
          input: {
            threadId: threadRef.threadId,
            promptProfileId: profileId === "" ? null : profileId,
          },
        });
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          failureToast("Could not change the prompt profile", squashAtomCommandFailure(result));
        }
        return;
      }
      const reportFailure = async (
        title: string,
        run: () => Promise<AtomCommandResult<unknown, unknown>>,
      ) => {
        const result = await run();
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          failureToast(title, squashAtomCommandFailure(result));
        }
      };
      switch (action) {
        case "find":
          onFind?.(threadRef);
          return;
        case "project-settings": {
          const project = projects.find(
            (candidate) =>
              candidate.environmentId === thread.environmentId && candidate.id === thread.projectId,
          );
          if (!project) return;
          const projectKey =
            logicalProjectKeyByPhysicalKey.get(derivePhysicalProjectKey(project)) ??
            deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings);
          void router.navigate({
            to: "/projects/$projectKey",
            params: { projectKey },
          });
          return;
        }
        case "new-thread-on-branch": {
          const result = await settlePromise(() =>
            handleNewThread(scopeProjectRef(threadRef.environmentId, thread.projectId), {
              branch: thread.branch,
              worktreePath: thread.worktreePath,
              envMode: thread.worktreePath ? "worktree" : "local",
              startFromOrigin: false,
            }),
          );
          if (result._tag === "Failure") {
            failureToast("Could not create thread", squashAtomCommandFailure(result));
          }
          return;
        }
        case "settle":
          await reportFailure("Failed to settle thread", () => settleThread(threadRef));
          return;
        case "unsettle":
          await reportFailure("Failed to un-settle thread", () => unsettleThread(threadRef));
          return;
        case "unsnooze":
          await reportFailure("Failed to wake thread", () => unsnoozeThread(threadRef));
          return;
        case "pin":
          await reportFailure("Failed to pin thread", () => pinThread(threadRef));
          return;
        case "unpin": {
          await reportFailure("Failed to unpin thread", () => confirmAndUnpinThread(threadRef));
          return;
        }
        case "prompt-profile":
          return;
        case "memories:on":
        case "memories:off":
          if (!(await threadMemoryChoice.choose(threadRef, action === "memories:off"))) {
            failureToast(
              "Could not change memories for this thread",
              new Error("Try again in a moment."),
            );
          }
          return;
        case "auto-settle:enabled":
        case "auto-settle:disabled":
          await reportFailure("Failed to update auto-settle", () =>
            setThreadAutoSettle(threadRef, action === "auto-settle:enabled"),
          );
          return;
        case "rename":
          onStartRename();
          return;
        case "regenerate-title":
          if (isRegeneratingTitle) return;
          await reportFailure("Failed to regenerate thread title", () =>
            updateThreadMetadata({
              environmentId: threadRef.environmentId,
              input: { threadId: threadRef.threadId, regenerateTitle: true },
            }),
          );
          return;
        case "mark-unread":
          markThreadUnread(threadRef);
          return;
        case "share-guest":
          openGuestShareDialog(threadRef);
          return;
        case "turn-into-project": {
          const result = await turnThreadIntoProject(threadRef);
          if (result._tag === "Success") {
            toastManager.add({
              type: "success",
              title: "Project created",
              description: thread.title,
            });
          } else if (!isAtomCommandInterrupted(result)) {
            failureToast("Could not turn thread into a project", squashAtomCommandFailure(result));
          }
          return;
        }
        case "copy-path": {
          const workspacePath = thread.worktreePath ?? projectCwd;
          if (!workspacePath) {
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Path unavailable",
                description: "This thread does not have a workspace path to copy.",
              }),
            );
            return;
          }
          copyPathToClipboard(workspacePath, { path: workspacePath });
          return;
        }
        case "copy-branch":
          if (thread.branch) {
            copyBranchToClipboard(thread.branch, { branch: thread.branch });
          }
          return;
        case "copy-thread":
          void copyThreadReference(
            threadChipCopyTarget(threadRef, thread.title, configuredHostedAppUrl()),
          );
          return;
        case "copy-thread-id":
          copyThreadIdToClipboard(thread.id, { threadId: thread.id });
          return;
        case "open-in-window":
          void openThreadInNewWindow(threadRef).catch((error: unknown) =>
            failureToast("Could not open a new window", error),
          );
          return;
        case "schedule-follow-up":
          void router.navigate({
            to: "/settings/scheduled-tasks",
            search: {
              environmentId: threadRef.environmentId,
              threadId: threadRef.threadId,
              projectId: thread.projectId,
            },
          });
          return;
        case "hand-off":
          requestHandoff({
            environmentId: threadRef.environmentId,
            threadId: threadRef.threadId,
            projectId: thread.projectId,
            current: thread.modelSelection,
            reason: thread.runtime?.lastErrorClass === "usage_limit" ? "usage_limit" : "manual",
          });
          return;
        case "move-to-worktree":
          await moveToWorktree(threadRef, { title: thread.title, projectCwd });
          return;
        case "return-to-project":
          await returnToProject(threadRef, thread.branch ?? null);
          return;
        case "archive": {
          if (confirmThreadArchive) {
            const confirmed = await settlePromise(() =>
              api.dialogs.confirm(`Archive thread "${thread.title}"?`),
            );
            if (confirmed._tag === "Failure" || !confirmed.value) return;
          }
          let didArchive = false;
          const result = await archiveThread(threadRef, {
            onArchived: () => {
              didArchive = true;
            },
          });
          if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
            failureToast(
              didArchive ? "Thread archived, but navigation failed" : "Failed to archive thread",
              squashAtomCommandFailure(result),
            );
          }
          return;
        }
        case "delete": {
          if (confirmThreadDelete) {
            const confirmed = await settlePromise(() =>
              api.dialogs.confirm(
                [
                  `Delete thread "${thread.title}"?`,
                  "This permanently clears conversation history for this thread.",
                ].join("\n"),
                { variant: "destructive" },
              ),
            );
            if (confirmed._tag === "Failure" || !confirmed.value) return;
          }
          const deleted = await deleteThread(threadRef);
          if (
            deleted._tag === "Failure" &&
            !isAtomCommandInterrupted(deleted) &&
            // A missing thread means cleanup failed after deletion; deleteThread already toasted that failure.
            readThreadShell(threadRef) !== null
          ) {
            failureToast("Failed to delete thread", squashAtomCommandFailure(deleted));
          }
          return;
        }
        default:
          return;
      }
    })();
  };

  const closeMenu = () => {
    void readLocalApi()?.contextMenu.close();
  };

  return { openMenu, closeMenu };
}
