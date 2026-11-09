import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@moonfold/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@moonfold/contracts";
import { sanitizeFeatureBranchName } from "@moonfold/shared/git";

import { requestWorktreeMove } from "../components/MoveToWorktreeDialog";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { readLocalApi } from "../localApi";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";

function failureToast(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

/**
 * Moves an idle thread between the project folder and a worktree of its own. Shared by the
 * sidebar row menu and the chat header menu.
 */
export function useThreadWorkspaceTransfer() {
  const moveThreadToWorktree = useAtomCommand(serverEnvironment.moveThreadToWorktree, {
    reportFailure: false,
  });
  const returnThreadToProject = useAtomCommand(serverEnvironment.returnThreadToProject, {
    reportFailure: false,
  });

  const moveToWorktree = async (
    threadRef: ScopedThreadRef,
    thread: { readonly title: string; readonly projectCwd: string | null },
  ) => {
    if (thread.projectCwd === null) {
      failureToast("Could not move the thread", new Error("The project folder is unavailable."));
      return;
    }
    const choice = await requestWorktreeMove({
      environmentId: threadRef.environmentId,
      projectCwd: thread.projectCwd,
      suggestedBranch: sanitizeFeatureBranchName(thread.title),
    });
    if (choice === null) return;
    const result = await moveThreadToWorktree({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, ...choice },
    });
    if (result._tag === "Success") {
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: `Thread moved to ${result.value.branch}`,
          description: result.value.worktreePath,
        }),
      );
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      failureToast("Could not move the thread", squashAtomCommandFailure(result));
    }
  };

  const returnToProject = async (threadRef: ScopedThreadRef, branch: string | null) => {
    const api = readLocalApi();
    if (!api) return;
    const confirmed = await settlePromise(() =>
      api.dialogs.confirm(
        [
          "Bring this thread back to the project folder?",
          `${branch ? `Commits on ${branch}` : "The worktree's commits"} are merged into the project's current branch and uncommitted changes come along. The project folder must have no uncommitted changes of its own. The worktree stays on disk.`,
        ].join("\n"),
      ),
    );
    if (confirmed._tag === "Failure" || !confirmed.value) return;
    const result = await returnThreadToProject({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
    if (result._tag === "Success") {
      const { mergedBranch, carriedChanges, branch: projectBranch } = result.value;
      const details = [
        mergedBranch ? `Merged ${mergedBranch} into ${projectBranch}.` : null,
        carriedChanges ? "Uncommitted changes came along." : null,
      ].filter((line) => line !== null);
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: "Thread is back in the project folder",
          description: details.length > 0 ? details.join(" ") : `On ${projectBranch}.`,
        }),
      );
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      failureToast("Could not bring the thread back", squashAtomCommandFailure(result));
    }
  };

  return { moveToWorktree, returnToProject };
}
