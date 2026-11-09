import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProjectId, RunId, ThreadId } from "@moonfold/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsStatusBroadcaster from "../vcs/VcsStatusBroadcaster.ts";
import * as WorktreeMcpService from "./WorktreeMcpService.ts";

const threadId = ThreadId.make("thread-1");
const projectId = ProjectId.make("project-1");

const gitLayer = GitVcsDriver.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "worktree-transfer-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

/**
 * A real repository with the worktree service on top. Thread and project records are kept in
 * memory; every git operation, including worktree creation, runs real git.
 */
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const run = (cwd: string, args: ReadonlyArray<string>) =>
    git.execute({ operation: "worktree-transfer-test", cwd, args });
  const project = (yield* fs.makeTempDirectoryScoped({ prefix: "transfer-project-" })).replaceAll(
    "\\",
    "/",
  );
  const worktrees = (yield* fs.makeTempDirectoryScoped({
    prefix: "transfer-worktrees-",
  })).replaceAll("\\", "/");
  yield* run(project, ["init", "-b", "main"]);
  yield* run(project, ["config", "user.email", "transfer@example.test"]);
  yield* run(project, ["config", "user.name", "Transfer test"]);
  yield* run(project, ["config", "core.autocrlf", "false"]);
  yield* fs.writeFileString(`${project}/app.txt`, "one\n");
  yield* run(project, ["add", "."]);
  yield* run(project, ["commit", "-m", "initial"]);

  const thread = {
    id: threadId,
    projectId,
    branch: "main" as string | null,
    worktreePath: null as string | null,
    deletedAt: null,
    archivedAt: null,
  };
  const runs: Array<{ id: RunId; status: string }> = [];
  const currentRef = (cwd: string) =>
    run(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).pipe(
      Effect.map((result) => {
        const name = result.stdout.trim();
        return name === "HEAD" ? null : name;
      }),
    );

  const layer = WorktreeMcpService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          getThreadRecords: () => Effect.succeed({ thread, runs } as never),
          dispatch: (command) =>
            Effect.sync(() => {
              if (command.type === "thread.metadata.update") {
                if (command.worktreePath !== undefined) thread.worktreePath = command.worktreePath;
                if (command.branch !== undefined) thread.branch = command.branch;
              }
              return {} as never;
            }),
        }),
        Layer.mock(ProjectService.ProjectService)({
          getById: () =>
            Effect.succeedSome({ id: projectId, workspaceRoot: project, scripts: [] } as never),
        }),
        // On by default: a move must still start from the local checkout (this repo has no origin).
        ServerSettings.layerTest({ newWorktreesStartFromOrigin: true }),
        Layer.mock(GitWorkflowService.GitWorkflowService)({
          localStatus: ({ cwd }) =>
            currentRef(cwd).pipe(
              Effect.map((refName) => ({ isRepo: true, refName }) as never),
              Effect.orDie,
            ),
          listLocalBranchNames: (cwd) =>
            run(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]).pipe(
              Effect.map((result) => result.stdout.trim().split("\n").filter(Boolean)),
            ),
          listRefs: () => Effect.succeed({ refs: [] } as never),
          createWorktree: (input) =>
            Effect.gen(function* () {
              const path = `${worktrees}/${input.newRefName}`;
              yield* run(input.cwd, [
                "worktree",
                "add",
                "-b",
                input.newRefName!,
                path,
                input.refName,
              ]);
              return { worktree: { path, refName: input.newRefName! } } as never;
            }).pipe(Effect.orDie),
          removeWorktree: (input) =>
            run(input.cwd, ["worktree", "remove", "--force", input.path]).pipe(Effect.asVoid),
          deleteLocalBranch: (input) =>
            run(input.cwd, ["branch", "-D", input.refName]).pipe(Effect.asVoid),
        }),
        Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({
          runForThread: () => Effect.succeed({ status: "no-script" } as never),
        }),
        Layer.mock(VcsStatusBroadcaster.VcsStatusBroadcaster)({
          refreshStatus: () => Effect.succeed({} as never),
        }),
      ),
    ),
  );
  return { fs, run, project, worktrees, thread, runs, layer };
});

const failureCode = (error: { readonly _tag: string }) =>
  "code" in error ? error.code : error._tag;

const status = (fx: Effect.Success<typeof fixture>, cwd: string) =>
  fx.run(cwd, ["status", "--porcelain"]).pipe(Effect.map((result) => result.stdout.trim()));

describe("moving a thread into a worktree", () => {
  it.effect("takes the project's uncommitted changes along", () =>
    Effect.gen(function* () {
      const fx = yield* fixture;
      yield* fx.fs.writeFileString(`${fx.project}/app.txt`, "one\ntwo\n");
      yield* fx.fs.writeFileString(`${fx.project}/notes.md`, "draft\n");

      const result = yield* Effect.gen(function* () {
        const service = yield* WorktreeMcpService.WorktreeMcpService;
        return yield* service.moveToNewWorktree({
          threadId,
          branch: "feature/carry",
          carryChanges: true,
        });
      }).pipe(Effect.provide(fx.layer));

      expect(result.branch).toBe("feature/carry");
      expect(fx.thread.worktreePath).toBe(result.worktreePath);
      expect(yield* status(fx, fx.project)).toBe("");
      expect(yield* fx.fs.readFileString(`${result.worktreePath}/app.txt`)).toBe("one\ntwo\n");
      expect(yield* fx.fs.readFileString(`${result.worktreePath}/notes.md`)).toBe("draft\n");
    }).pipe(Effect.provide(gitLayer), Effect.scoped),
  );

  it.effect("refuses while the agent is working in the thread", () =>
    Effect.gen(function* () {
      const fx = yield* fixture;
      fx.runs.push({ id: RunId.make("run-1"), status: "running" });
      const error = yield* Effect.gen(function* () {
        const service = yield* WorktreeMcpService.WorktreeMcpService;
        return yield* service.moveToNewWorktree({
          threadId,
          branch: "feature/busy",
          carryChanges: true,
        });
      }).pipe(Effect.provide(fx.layer), Effect.flip);
      expect(failureCode(error)).toBe("invalid_request");
      expect(fx.thread.worktreePath).toBeNull();
    }).pipe(Effect.provide(gitLayer), Effect.scoped),
  );
});

describe("bringing a thread back to its project", () => {
  const moveThenWork = Effect.gen(function* () {
    const fx = yield* fixture;
    const service = yield* WorktreeMcpService.WorktreeMcpService.pipe(Effect.provide(fx.layer));
    const moved = yield* service.moveToNewWorktree({
      threadId,
      branch: "feature/work",
      carryChanges: false,
    });
    // The agent commits one change and leaves another uncommitted.
    yield* fx.fs.writeFileString(`${moved.worktreePath}/app.txt`, "one\ncommitted\n");
    yield* fx.run(moved.worktreePath, ["commit", "-am", "work"]);
    yield* fx.fs.writeFileString(`${moved.worktreePath}/todo.md`, "next\n");
    return { fx, service, worktreePath: moved.worktreePath };
  });

  it.effect("merges the worktree's commits and brings its uncommitted changes", () =>
    Effect.gen(function* () {
      const { fx, service, worktreePath } = yield* moveThenWork;
      const result = yield* service.returnToProject(threadId);

      expect(result).toEqual({
        projectPath: fx.project,
        branch: "main",
        mergedBranch: "feature/work",
        carriedChanges: true,
      });
      expect(fx.thread.worktreePath).toBeNull();
      expect(fx.thread.branch).toBe("main");
      expect(yield* fx.fs.readFileString(`${fx.project}/app.txt`)).toBe("one\ncommitted\n");
      expect(yield* fx.fs.readFileString(`${fx.project}/todo.md`)).toBe("next\n");
      expect(yield* status(fx, worktreePath)).toBe("");
    }).pipe(Effect.provide(gitLayer), Effect.scoped),
  );

  it.effect("refuses when the project checkout has its own uncommitted changes", () =>
    Effect.gen(function* () {
      const { fx, service, worktreePath } = yield* moveThenWork;
      yield* fx.fs.writeFileString(`${fx.project}/local.txt`, "mine\n");
      const error = yield* Effect.flip(service.returnToProject(threadId));
      expect(failureCode(error)).toBe("invalid_request");
      expect(fx.thread.worktreePath).toBe(worktreePath);
      expect(yield* fx.fs.readFileString(`${fx.project}/app.txt`)).toBe("one\n");
    }).pipe(Effect.provide(gitLayer), Effect.scoped),
  );

  it.effect("changes nothing when the merge conflicts", () =>
    Effect.gen(function* () {
      const { fx, service, worktreePath } = yield* moveThenWork;
      yield* fx.fs.writeFileString(`${fx.project}/app.txt`, "one\nconflicting\n");
      yield* fx.run(fx.project, ["commit", "-am", "conflicting work"]);
      const error = yield* Effect.flip(service.returnToProject(threadId));
      expect(failureCode(error)).toBe("operation_failed");
      expect(fx.thread.worktreePath).toBe(worktreePath);
      expect(yield* status(fx, fx.project)).toBe("");
      expect(yield* fx.fs.readFileString(`${fx.project}/app.txt`)).toBe("one\nconflicting\n");
      expect(yield* fx.fs.readFileString(`${worktreePath}/todo.md`)).toBe("next\n");
    }).pipe(Effect.provide(gitLayer), Effect.scoped),
  );
});

describe("moving a thread into an existing worktree", () => {
  it.effect("points the thread at it and brings the project's uncommitted changes", () =>
    Effect.gen(function* () {
      const fx = yield* fixture;
      const existing = `${fx.worktrees}/existing`;
      yield* fx.run(fx.project, ["worktree", "add", "-b", "feature/existing", existing]);
      yield* fx.fs.writeFileString(`${fx.project}/notes.md`, "draft\n");

      const result = yield* Effect.gen(function* () {
        const service = yield* WorktreeMcpService.WorktreeMcpService;
        return yield* service.moveToNewWorktree({
          threadId,
          worktreePath: existing,
          carryChanges: true,
        });
      }).pipe(Effect.provide(fx.layer));

      expect(result.branch).toBe("feature/existing");
      // Stored the way git lists it, like the paths of worktrees Moonfold creates.
      expect(result.worktreePath).toBe(existing);
      expect(fx.thread.branch).toBe("feature/existing");
      expect(fx.thread.worktreePath).toBe(result.worktreePath);
      expect(yield* status(fx, fx.project)).toBe("");
      expect(yield* fx.fs.readFileString(`${existing}/notes.md`)).toBe("draft\n");
    }).pipe(Effect.provide(gitLayer), Effect.scoped),
  );

  it.effect("refuses a folder that is not one of the project's worktrees", () =>
    Effect.gen(function* () {
      const fx = yield* fixture;
      const error = yield* Effect.gen(function* () {
        const service = yield* WorktreeMcpService.WorktreeMcpService;
        return yield* service.moveToNewWorktree({
          threadId,
          worktreePath: fx.worktrees,
          carryChanges: false,
        });
      }).pipe(Effect.provide(fx.layer), Effect.flip);
      expect(failureCode(error)).toBe("invalid_request");
      expect(fx.thread.worktreePath).toBeNull();
    }).pipe(Effect.provide(gitLayer), Effect.scoped),
  );

  it.effect("keeps the target's own uncommitted work safe", () =>
    Effect.gen(function* () {
      const fx = yield* fixture;
      const existing = `${fx.worktrees}/busy`;
      yield* fx.run(fx.project, ["worktree", "add", "-b", "feature/busy", existing]);
      yield* fx.fs.writeFileString(`${existing}/theirs.md`, "keep me\n");
      yield* fx.fs.writeFileString(`${fx.project}/mine.md`, "mine\n");
      const error = yield* Effect.gen(function* () {
        const service = yield* WorktreeMcpService.WorktreeMcpService;
        return yield* service.moveToNewWorktree({
          threadId,
          worktreePath: existing,
          carryChanges: true,
        });
      }).pipe(Effect.provide(fx.layer), Effect.flip);
      expect(failureCode(error)).toBe("invalid_request");
      expect(yield* fx.fs.readFileString(`${existing}/theirs.md`)).toBe("keep me\n");
      expect(yield* fx.fs.readFileString(`${fx.project}/mine.md`)).toBe("mine\n");
    }).pipe(Effect.provide(gitLayer), Effect.scoped),
  );
});
