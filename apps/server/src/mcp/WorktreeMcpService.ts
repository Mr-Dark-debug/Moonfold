import {
  CommandId,
  type GitCommandError,
  MessageId,
  type ProjectId,
  type ThreadId,
  type ThreadMoveToWorktreeInput,
  type ThreadReturnToProjectResult,
  WorktreeMcpFailure,
  type WorktreeMcpContinuationStatus,
  type WorktreeMcpHandoffInput,
  type WorktreeMcpHandoffResult,
  type WorktreeMcpSetupScriptStatus,
  type WorktreeMcpStatusResult,
  type VcsListRefsInput,
  type VcsListRefsResult,
} from "@moonfold/contracts";
import { resolveProjectSettings } from "@moonfold/shared/projectSettings";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";

import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import type { McpInvocationScope, McpThreadCaller } from "./McpInvocationContext.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

/** The thread a handoff moves, and the seed its command ids derive from. */
interface HandoffTarget {
  readonly thread: Pick<McpThreadCaller, "threadId" | "providerSessionId">;
}

export class WorktreeMcpService extends Context.Service<
  WorktreeMcpService,
  {
    readonly handoff: (
      scope: McpInvocationScope,
      input: WorktreeMcpHandoffInput,
    ) => Effect.Effect<WorktreeMcpHandoffResult, WorktreeMcpFailure>;
    readonly status: (
      scope: McpInvocationScope,
    ) => Effect.Effect<WorktreeMcpStatusResult, WorktreeMcpFailure>;
    /**
     * The user moves an idle thread from the project folder into a new worktree or an existing
     * one, optionally with the folder's uncommitted changes.
     */
    readonly moveToNewWorktree: (
      input: ThreadMoveToWorktreeInput,
    ) => Effect.Effect<WorktreeMcpHandoffResult, WorktreeMcpFailure>;
    /**
     * The user brings an idle thread's worktree work back to the project checkout: the worktree
     * branch is merged into the checkout's branch, uncommitted changes come over, and the thread
     * points at the project folder again. The checkout must be clean, so a failure undoes itself.
     */
    readonly returnToProject: (
      threadId: ThreadId,
    ) => Effect.Effect<ThreadReturnToProjectResult, WorktreeMcpFailure>;
    readonly listRefs: (
      input: Omit<VcsListRefsInput, "cwd"> & {
        readonly worktreePath: string | null;
        readonly workspaceRoot: string;
      },
    ) => Effect.Effect<VcsListRefsResult, GitCommandError | PlatformError.PlatformError>;
  }
>()("moonfold/mcp/WorktreeMcpService") {}

function failure(code: WorktreeMcpFailure["code"], message: string): WorktreeMcpFailure {
  return new WorktreeMcpFailure({ code, message });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

const asOperationFailed = (prefix: string) =>
  Effect.mapError((error: unknown) =>
    failure("operation_failed", `${prefix}: ${errorMessage(error)}`),
  );

const make = Effect.gen(function* () {
  const random = yield* SecureRandom.SecureRandom;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const setupScriptRunner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
  const vcsStatusBroadcaster = yield* VcsStatusBroadcaster.VcsStatusBroadcaster;
  const git = yield* GitVcsDriver.GitVcsDriver;

  const runGit = (cwd: string, args: ReadonlyArray<string>) =>
    git
      .execute({ operation: `WorktreeTransfer.${args[0]}`, cwd, args })
      .pipe(asOperationFailed(`git ${args.join(" ")} failed in ${cwd}`));

  const hasUncommittedChanges = (cwd: string) =>
    runGit(cwd, ["status", "--porcelain"]).pipe(
      Effect.map((result) => result.stdout.trim().length > 0),
    );

  /**
   * Moves uncommitted work (tracked and untracked) from one checkout of the repository to
   * another through the shared stash. `to` must start clean: when the work does not apply
   * there, the partial apply is discarded and the work returns to `from`.
   */
  const carryUncommittedChanges = Effect.fn("WorktreeMcpService.carryUncommittedChanges")(
    function* (from: string, to: string) {
      if (!(yield* hasUncommittedChanges(from))) return false;
      yield* runGit(from, [
        "stash",
        "push",
        "--include-untracked",
        "--message",
        "moonfold: move uncommitted changes",
      ]);
      const applied = yield* git
        .execute({
          operation: "WorktreeTransfer.apply",
          cwd: to,
          args: ["stash", "apply"],
          allowNonZeroExit: true,
        })
        .pipe(asOperationFailed(`git stash apply failed in ${to}`));
      if (applied.exitCode !== 0) {
        yield* runGit(to, ["reset", "--hard", "HEAD"]);
        yield* runGit(to, ["clean", "-fd"]);
        yield* runGit(from, ["stash", "pop"]);
        return yield* failure(
          "operation_failed",
          `The uncommitted changes in ${from} do not apply cleanly in ${to}; they were left where they were.`,
        );
      }
      yield* runGit(from, ["stash", "drop"]);
      return true;
    },
  );

  // Serialize handoffs per thread to avoid creating two worktrees and orphaning one.
  const handoffThreadsInFlight = new Set<string>();

  const requireThreadScope = (scope: McpInvocationScope) =>
    scope.thread === undefined
      ? Effect.fail(
          failure(
            "thread_credential_required",
            "Worktree handoff and status act as the calling Moonfold thread, so they need an agent running inside Moonfold.",
          ),
        )
      : Effect.succeed(scope as McpInvocationScope & { readonly thread: McpThreadCaller });

  const requireCapability = (scope: McpInvocationScope) =>
    scope.capabilities.has("worktree")
      ? Effect.void
      : Effect.fail(
          failure("capability_denied", "This MCP credential does not grant worktree capabilities."),
        );

  const loadThread = (scope: HandoffTarget) =>
    threadManagement.getThreadRecords(scope.thread.threadId, []).pipe(
      Effect.mapError((error) =>
        error._tag === "OrchestratorProjectionError"
          ? failure("thread_not_found", `Thread '${scope.thread.threadId}' was not found.`)
          : failure(
              "operation_failed",
              `Unable to read thread ${scope.thread.threadId}: ${errorMessage(error)}`,
            ),
      ),
      Effect.filterOrFail(
        (projection) => projection.thread.deletedAt === null,
        () => failure("thread_not_found", `Thread '${scope.thread.threadId}' was not found.`),
      ),
    );

  const loadProject = (scope: HandoffTarget, projectId: ProjectId) =>
    projects.getById(projectId).pipe(
      asOperationFailed(`Unable to read project ${projectId}`),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              failure(
                "project_not_found",
                `Project '${projectId}' was not found for thread '${scope.thread.threadId}'.`,
              ),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );

  const readDefaultStartFromOrigin = (projectId: ProjectId) =>
    serverSettings.getSettings.pipe(
      Effect.map(
        (settings) =>
          resolveProjectSettings(settings, projectId).settings.newWorktreesStartFromOrigin,
      ),
      asOperationFailed("Unable to read server settings"),
    );

  const handoffIds = (scope: HandoffTarget) =>
    random.uuidV4().pipe(
      Effect.map((uuid) => {
        const part = (kind: string, operation: string) =>
          [kind, "mcp", encodeURIComponent(scope.thread.providerSessionId), operation, uuid].join(
            ":",
          );
        return {
          commandId: CommandId.make(part("command", "worktree-handoff")),
          continuationCommandId: CommandId.make(part("command", "worktree-continuation")),
          continuationMessageId: MessageId.make(part("message", "worktree-continuation")),
        };
      }),
      Effect.orDie,
    );

  const performHandoff = Effect.fn("WorktreeMcpService.performHandoff")(function* (
    scope: HandoffTarget,
    input: WorktreeMcpHandoffInput,
    options: { readonly carryChanges?: boolean } = {},
  ) {
    const alreadyInWorktree = (worktreePath: string) =>
      failure(
        "already_in_worktree",
        `Thread '${scope.thread.threadId}' is already attached to worktree '${worktreePath}'.`,
      );

    const projection = yield* loadThread(scope);
    if (projection.thread.worktreePath !== null) {
      return yield* alreadyInWorktree(projection.thread.worktreePath);
    }
    if (projection.thread.archivedAt !== null) {
      return yield* failure(
        "invalid_request",
        `Thread '${scope.thread.threadId}' is archived and cannot be handed off to a worktree.`,
      );
    }

    const project = yield* loadProject(scope, projection.thread.projectId);
    const projectCwd = project.workspaceRoot;

    const localStatus = yield* gitWorkflow
      .localStatus({ cwd: projectCwd })
      .pipe(asOperationFailed("Unable to read git status"));
    if (!localStatus.isRepo) {
      return yield* failure(
        "invalid_request",
        `Project workspace '${projectCwd}' is not a git repository.`,
      );
    }

    const localBranchNames = yield* gitWorkflow
      .listLocalBranchNames(projectCwd)
      .pipe(asOperationFailed("Unable to list branches"));
    if (localBranchNames.includes(input.branch)) {
      const existingRef = yield* gitWorkflow
        .listRefs({ cwd: projectCwd, query: input.branch, refKind: "local" })
        .pipe(
          Effect.map((result) =>
            result.refs.find((ref) => ref.name === input.branch && ref.isRemote !== true),
          ),
          Effect.orElseSucceed(() => undefined),
        );
      const checkoutPath = existingRef?.worktreePath ?? null;
      return yield* failure(
        "invalid_request",
        `Branch '${input.branch}' already exists${
          checkoutPath === null ? "" : ` and is checked out at '${checkoutPath}'`
        }. Choose a different branch name, or delete the existing branch${
          checkoutPath === null ? "" : " and its worktree"
        } first.`,
      );
    }

    let baseRef = input.baseRef;
    if (baseRef === undefined) {
      if (localStatus.refName === null) {
        return yield* failure(
          "invalid_request",
          "Could not determine the current branch of the project workspace (detached HEAD?). Pass baseRef explicitly.",
        );
      }
      baseRef = localStatus.refName;
    }

    const startFromOrigin =
      input.startFromOrigin ?? (yield* readDefaultStartFromOrigin(project.id));

    let worktreeBaseRef = baseRef;
    let baseRefName = baseRef;
    let startedFromOrigin = false;
    if (startFromOrigin) {
      const resolvedRemoteBase = yield* gitWorkflow
        .fetchWorktreeBaseCommit({ cwd: projectCwd, refName: baseRef })
        .pipe(asOperationFailed(`Unable to fetch the remote base of '${baseRef}'`));
      if (resolvedRemoteBase !== null) {
        worktreeBaseRef = resolvedRemoteBase.commitSha;
        baseRefName = `refs/remotes/${resolvedRemoteBase.remoteRefName}`;
        startedFromOrigin = true;
      }
    }

    const ids = yield* handoffIds(scope);

    // Mask interruption after worktree creation through setup; binding can detach and interrupt the caller.
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const worktree = yield* restore(
          gitWorkflow
            .createWorktree({
              cwd: projectCwd,
              refName: worktreeBaseRef,
              newRefName: input.branch,
              baseRefName,
              path: null,
            })
            .pipe(asOperationFailed("Unable to create the worktree")),
        );
        const worktreePath = worktree.worktree.path;

        const reportFailed = (logMessage: string) =>
          Effect.catchCause((cause: Cause.Cause<unknown>) => {
            const detail = errorMessage(Cause.squash(cause));
            return Effect.logWarning(logMessage, {
              threadId: scope.thread.threadId,
              worktreePath,
              detail,
            }).pipe(Effect.as({ status: "failed", detail } as const));
          });

        const removeCreatedWorktree = Effect.suspend(() =>
          gitWorkflow.removeWorktree({ cwd: projectCwd, path: worktreePath, force: true }).pipe(
            Effect.andThen(
              Effect.suspend(() =>
                gitWorkflow.deleteLocalBranch({
                  cwd: projectCwd,
                  refName: worktree.worktree.refName,
                  force: true,
                }),
              ),
            ),
          ),
        ).pipe(Effect.ignoreCause({ log: true }));

        // Moving a thread takes its uncommitted work along when asked. A failure puts the work
        // back in the project checkout and removes the new worktree.
        if (options.carryChanges === true) {
          yield* carryUncommittedChanges(projectCwd, worktreePath).pipe(
            Effect.onError((cause) =>
              Cause.hasInterruptsOnly(cause) ? Effect.void : removeCreatedWorktree,
            ),
          );
        }

        const recheckAndBind = Effect.gen(function* () {
          // A concurrent UI binding may have landed during git work; do not orphan a second worktree.
          const recheck = yield* loadThread(scope);
          if (recheck.thread.worktreePath !== null) {
            return yield* alreadyInWorktree(recheck.thread.worktreePath);
          }
          if (recheck.thread.archivedAt !== null) {
            return yield* failure(
              "invalid_request",
              `Thread '${scope.thread.threadId}' was archived while the worktree was being created; the handoff was rolled back.`,
            );
          }
          yield* threadManagement
            .dispatch({
              type: "thread.metadata.update",
              commandId: ids.commandId,
              threadId: scope.thread.threadId,
              branch: worktree.worktree.refName,
              worktreePath,
              expectedWorktreePath: null,
            })
            .pipe(
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.failCause(cause as Cause.Cause<never>)
                  : Effect.fail(
                      failure(
                        "operation_failed",
                        `Unable to re-point the thread at the worktree: ${errorMessage(Cause.squash(cause))}`,
                      ),
                    ),
              ),
            );
        }).pipe(
          // Do not remove on interruption alone; the thread binding may already have committed.
          Effect.onError((cause) =>
            Cause.hasInterruptsOnly(cause) ? Effect.void : removeCreatedWorktree,
          ),
        );

        // Queue continuation immediately after binding; detachment terminates the caller, so relaunch needs a durable message.
        const queueContinuation: Effect.Effect<WorktreeMcpContinuationStatus, WorktreeMcpFailure> =
          Effect.suspend(() =>
            input.continuationPrompt === undefined
              ? Effect.succeed<WorktreeMcpContinuationStatus>({ status: "skipped" })
              : threadManagement
                  .sendToThread({
                    projectId: projection.thread.projectId,
                    commandId: ids.continuationCommandId,
                    threadId: scope.thread.threadId,
                    messageId: ids.continuationMessageId,
                    text: input.continuationPrompt,
                    attachments: [],
                    mode: "queue",
                    createdBy: "agent",
                    creationSource: "mcp",
                  })
                  .pipe(
                    Effect.map((sendResult): WorktreeMcpContinuationStatus => ({
                      status: "scheduled",
                      delivery: sendResult.delivery,
                    })),
                    reportFailed("worktree handoff continuation failed to queue"),
                  ),
          );

        const continuation = yield* recheckAndBind.pipe(Effect.andThen(queueContinuation));

        yield* vcsStatusBroadcaster
          .refreshStatus(worktreePath)
          .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach);

        let setupScript: WorktreeMcpSetupScriptStatus = { status: "skipped" };
        if (input.runSetupScript ?? true) {
          setupScript = yield* setupScriptRunner
            .runForThread({
              threadId: scope.thread.threadId,
              projectId: projection.thread.projectId,
              projectCwd,
              worktreePath,
              project: {
                id: project.id,
                workspaceRoot: project.workspaceRoot,
                scripts: project.scripts,
              },
            })
            .pipe(
              Effect.map((result): WorktreeMcpSetupScriptStatus =>
                result.status === "started"
                  ? {
                      status: "started",
                      scriptName: result.scriptName,
                      terminalId: result.terminalId,
                    }
                  : result.status === "skipped-for-link"
                    ? { status: "skipped" }
                    : { status: "no-script" },
              ),
              reportFailed("worktree handoff setup script failed"),
            );
        }

        const result: WorktreeMcpHandoffResult = {
          worktreePath,
          branch: worktree.worktree.refName,
          baseRef,
          startedFromOrigin,
          setupScript,
          continuation,
          note:
            continuation.status === "scheduled"
              ? "Handoff recorded. Changing the workspace detaches this provider session, so the current turn ends shortly after this call; the queued continuation prompt then starts the next turn inside the worktree with the conversation preserved. The worktree is not removed automatically when the thread is deleted."
              : "Handoff recorded. Changing the workspace detaches this provider session, so the current turn ends shortly after this call; the conversation continues inside the worktree when the thread receives its next message. Pass continuationPrompt to resume automatically. The worktree is not removed automatically when the thread is deleted.",
        };
        return result;
      }),
    );
  });

  // One workspace change per thread at a time. uninterruptibleMask: the guard acquisition and
  // the registration of the releasing finalizer happen with no interruptible gap in between. An
  // interrupt landing between a bare add() and the start of an ensured effect would otherwise
  // leak the guard entry and block every future handoff for this thread until restart.
  const exclusively = <A>(
    threadId: ThreadId,
    effect: Effect.Effect<A, WorktreeMcpFailure>,
  ): Effect.Effect<A, WorktreeMcpFailure> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.suspend(() => {
        if (handoffThreadsInFlight.has(threadId)) {
          return Effect.fail(
            failure(
              "handoff_in_progress",
              `A worktree handoff is already in progress for thread '${threadId}'.`,
            ),
          );
        }
        handoffThreadsInFlight.add(threadId);
        return restore(effect).pipe(
          Effect.ensuring(Effect.sync(() => handoffThreadsInFlight.delete(threadId))),
        );
      }),
    );

  const handoff: WorktreeMcpService["Service"]["handoff"] = Effect.fn("WorktreeMcpService.handoff")(
    function* (callerScope, input) {
      yield* requireCapability(callerScope);
      const scope = yield* requireThreadScope(callerScope);
      return yield* exclusively(scope.thread.threadId, performHandoff(scope, input));
    },
  );

  const userTarget = (threadId: ThreadId): HandoffTarget => ({
    thread: { threadId, providerSessionId: `user:${threadId}` },
  });

  /** A user moves files under a thread only while its agent is not working in them. */
  const requireIdle = (target: HandoffTarget) =>
    loadThread(target).pipe(
      Effect.tap(() =>
        threadManagement.getThreadRecords(target.thread.threadId, ["runs"]).pipe(
          asOperationFailed(`Unable to read thread ${target.thread.threadId}`),
          Effect.filterOrFail(
            ({ runs }) =>
              !runs.some((run) =>
                ["preparing", "starting", "running", "waiting"].includes(run.status),
              ),
            () =>
              failure(
                "invalid_request",
                "The agent is still working in this thread. Stop it or wait for it to finish first.",
              ),
          ),
        ),
      ),
    );

  /**
   * The repository's worktrees by resolved path: the path as git spells it (how thread worktree
   * paths are stored) and the branch checked out there.
   */
  const listWorktrees = (cwd: string) =>
    runGit(cwd, ["worktree", "list", "--porcelain"]).pipe(
      Effect.map((result) => {
        const worktrees = new Map<string, { path: string; branch: string | null }>();
        let current: { path: string; branch: string | null } | null = null;
        for (const line of result.stdout.split(/\r?\n/)) {
          if (line.startsWith("worktree ")) {
            current = { path: line.slice("worktree ".length), branch: null };
            worktrees.set(path.resolve(current.path), current);
          } else if (current !== null && line.startsWith("branch ")) {
            current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
          }
        }
        return worktrees;
      }),
    );

  const performMoveToExisting = Effect.fn("WorktreeMcpService.performMoveToExisting")(function* (
    threadId: ThreadId,
    requestedPath: string,
    carryChanges: boolean,
  ) {
    const target = userTarget(threadId);
    const projection = yield* requireIdle(target);
    if (projection.thread.worktreePath !== null) {
      return yield* failure(
        "already_in_worktree",
        `This thread already works in ${projection.thread.worktreePath}. Bring it back to the project folder first.`,
      );
    }
    const project = yield* loadProject(target, projection.thread.projectId);
    const projectCwd = project.workspaceRoot;
    const resolved = path.resolve(requestedPath);
    if (resolved === path.resolve(projectCwd)) {
      return yield* failure("invalid_request", "This thread already works in the project folder.");
    }
    const worktree = (yield* listWorktrees(projectCwd)).get(resolved);
    if (worktree === undefined) {
      return yield* failure(
        "invalid_request",
        `${requestedPath} is not a worktree of ${projectCwd}.`,
      );
    }
    const { path: worktreePath, branch } = worktree;
    let carried = false;
    if (carryChanges) {
      // The carry undoes a failed apply with a hard reset, so the target must have nothing
      // of its own to lose.
      if (yield* hasUncommittedChanges(worktreePath)) {
        return yield* failure(
          "invalid_request",
          `${worktreePath} has uncommitted changes of its own. Commit or stash them there, or move without taking changes along.`,
        );
      }
      carried = yield* carryUncommittedChanges(projectCwd, worktreePath);
    }
    const ids = yield* handoffIds(target);
    yield* threadManagement
      .dispatch({
        type: "thread.metadata.update",
        commandId: ids.commandId,
        threadId,
        branch,
        worktreePath,
        expectedWorktreePath: null,
      })
      .pipe(asOperationFailed("Unable to point the thread at the worktree"));
    yield* Effect.forEach([projectCwd, worktreePath], (cwd) =>
      vcsStatusBroadcaster
        .refreshStatus(cwd)
        .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach),
    );
    const result: WorktreeMcpHandoffResult = {
      worktreePath,
      branch: branch ?? "HEAD",
      baseRef: branch ?? "HEAD",
      startedFromOrigin: false,
      setupScript: { status: "skipped" },
      continuation: { status: "skipped" },
      note: carried
        ? "The thread now works in the existing worktree, with the project folder's uncommitted changes."
        : "The thread now works in the existing worktree.",
    };
    return result;
  });

  const moveToNewWorktree: WorktreeMcpService["Service"]["moveToNewWorktree"] = (input) => {
    const target = userTarget(input.threadId);
    if ("worktreePath" in input) {
      return exclusively(
        input.threadId,
        performMoveToExisting(input.threadId, input.worktreePath, input.carryChanges),
      );
    }
    return exclusively(
      input.threadId,
      requireIdle(target).pipe(
        Effect.andThen(
          // The thread's work (and any carried changes) sits on the local checkout, so the new
          // branch starts there, never from origin's tip.
          performHandoff(
            target,
            { branch: input.branch, startFromOrigin: false },
            { carryChanges: input.carryChanges },
          ),
        ),
      ),
    );
  };

  const performReturn = Effect.fn("WorktreeMcpService.performReturn")(function* (
    threadId: ThreadId,
  ) {
    const target = userTarget(threadId);
    const projection = yield* requireIdle(target);
    const worktreePath = projection.thread.worktreePath;
    if (worktreePath === null) {
      return yield* failure("invalid_request", "This thread already works in the project folder.");
    }
    const project = yield* loadProject(target, projection.thread.projectId);
    const projectCwd = project.workspaceRoot;
    if (path.resolve(worktreePath) === path.resolve(projectCwd)) {
      return yield* failure("invalid_request", "This thread already works in the project folder.");
    }
    if (yield* hasUncommittedChanges(projectCwd)) {
      return yield* failure(
        "invalid_request",
        `${projectCwd} has uncommitted changes. Commit or stash them first, so the thread's work can come back cleanly.`,
      );
    }
    const projectStatus = yield* gitWorkflow
      .localStatus({ cwd: projectCwd })
      .pipe(asOperationFailed("Unable to read git status"));
    const projectBranch = projectStatus.refName;
    if (projectBranch === null) {
      return yield* failure(
        "invalid_request",
        `${projectCwd} is not on a branch (detached HEAD). Switch to a branch first.`,
      );
    }
    const worktreeBranch =
      projection.thread.branch ??
      (yield* gitWorkflow
        .localStatus({ cwd: worktreePath })
        .pipe(asOperationFailed("Unable to read the worktree's git status"))).refName;

    let mergedBranch: string | null = null;
    if (worktreeBranch !== null && worktreeBranch !== projectBranch) {
      const ahead = yield* runGit(projectCwd, [
        "rev-list",
        "--count",
        `${projectBranch}..${worktreeBranch}`,
      ]);
      if (Number.parseInt(ahead.stdout.trim(), 10) > 0) {
        const merged = yield* git
          .execute({
            operation: "WorktreeTransfer.merge",
            cwd: projectCwd,
            args: ["merge", "--no-edit", worktreeBranch],
            allowNonZeroExit: true,
          })
          .pipe(asOperationFailed(`git merge failed in ${projectCwd}`));
        if (merged.exitCode !== 0) {
          yield* runGit(projectCwd, ["merge", "--abort"]);
          return yield* failure(
            "operation_failed",
            `Merging ${worktreeBranch} into ${projectBranch} conflicts, so nothing was changed. Resolve it in the worktree (for example by merging ${projectBranch} there) and try again.`,
          );
        }
        mergedBranch = worktreeBranch;
      }
    }

    const carriedChanges = yield* carryUncommittedChanges(worktreePath, projectCwd);

    const ids = yield* handoffIds(target);
    yield* threadManagement
      .dispatch({
        type: "thread.metadata.update",
        commandId: ids.commandId,
        threadId,
        branch: projectBranch,
        worktreePath: null,
        expectedWorktreePath: worktreePath,
      })
      .pipe(asOperationFailed("Unable to point the thread at the project folder"));
    yield* Effect.forEach([projectCwd, worktreePath], (cwd) =>
      vcsStatusBroadcaster
        .refreshStatus(cwd)
        .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach),
    );
    return { projectPath: projectCwd, branch: projectBranch, mergedBranch, carriedChanges };
  });

  const returnToProject: WorktreeMcpService["Service"]["returnToProject"] = (threadId) =>
    exclusively(threadId, performReturn(threadId));

  const status: WorktreeMcpService["Service"]["status"] = Effect.fn("WorktreeMcpService.status")(
    function* (callerScope) {
      yield* requireCapability(callerScope);
      const scope = yield* requireThreadScope(callerScope);
      const projection = yield* loadThread(scope);
      const project = yield* loadProject(scope, projection.thread.projectId);

      const defaultStartFromOrigin = yield* readDefaultStartFromOrigin(project.id);

      const result: WorktreeMcpStatusResult = {
        attached: projection.thread.worktreePath !== null,
        worktreePath: projection.thread.worktreePath,
        branch: projection.thread.branch,
        projectWorkspaceRoot: project.workspaceRoot,
        defaultStartFromOrigin,
      };
      return result;
    },
  );

  const listRefs: WorktreeMcpService["Service"]["listRefs"] = Effect.fn(
    "WorktreeMcpService.listRefs",
  )(function* ({ worktreePath, workspaceRoot, ...refs }) {
    // Storage cleanup removes a worktree but keeps its path on the thread.
    const cwd =
      worktreePath !== null && (yield* fileSystem.exists(worktreePath))
        ? worktreePath
        : workspaceRoot;
    return yield* gitWorkflow.listRefs({ ...refs, cwd });
  });

  return WorktreeMcpService.of({ handoff, status, moveToNewWorktree, returnToProject, listRefs });
});

export const layer: Layer.Layer<
  WorktreeMcpService,
  never,
  | SecureRandom.SecureRandom
  | FileSystem.FileSystem
  | Path.Path
  | ThreadManagementService.ThreadManagementService
  | ProjectService.ProjectService
  | ServerSettings.ServerSettingsService
  | GitWorkflowService.GitWorkflowService
  | ProjectSetupScriptRunner.ProjectSetupScriptRunner
  | VcsStatusBroadcaster.VcsStatusBroadcaster
  | GitVcsDriver.GitVcsDriver
> = Layer.effect(WorktreeMcpService, make);
