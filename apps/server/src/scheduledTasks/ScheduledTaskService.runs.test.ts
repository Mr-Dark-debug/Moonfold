import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { ScheduledTaskUpsertInput, ThreadId } from "@moonfold/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ScheduledTaskService from "./ScheduledTaskService.ts";

const decodeUpsertInput = Schema.decodeUnknownEffect(ScheduledTaskUpsertInput);
const threadId = ThreadId.make("thread-from-task");

/**
 * A thread whose run answers the launched message. Tests flip its status to model the agent's
 * turn progressing; launches can be made to fail.
 */
function makeHarness() {
  const state = {
    launchedMessageId: null as string | null,
    runStatus: "running" as string,
    failLaunch: false,
  };
  const dependencies = Layer.mergeAll(
    NodeCrypto.layer,
    Scheduler.layer,
    ManagedPolicy.layerTest(),
    Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
      namedProjectsRoot: "/projects",
      isScratchProject: () => Effect.succeed(false),
    }),
    Layer.mock(ThreadLaunchService.ThreadLaunchService)({
      launch: (input) =>
        state.failLaunch
          ? Effect.fail(
              new ThreadLaunchService.ThreadLaunchError({
                operation: "resolve-project",
                commandId: input.commandId,
                projectId: input.projectId,
                cause: new Error("The project is gone."),
              }),
            )
          : Effect.sync(() => {
              state.launchedMessageId = input.initialMessage?.messageId ?? null;
              return { threadId, projection: {} as never, resumed: false };
            }),
    }),
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      getThreadRecords: () =>
        Effect.sync(
          () =>
            ({
              thread: { id: threadId },
              runs: [
                {
                  id: "orchestration-run-1",
                  userMessageId: state.launchedMessageId,
                  status: state.runStatus,
                },
              ],
            }) as never,
        ),
    }),
    Layer.mock(SecretRequests.SecretRequests)({}),
  );
  return { state, layer: ScheduledTaskService.layer.pipe(Layer.provide(dependencies)) };
}

const task = (notify?: string) =>
  decodeUpsertInput({
    title: "Nightly summary",
    prompt: "Summarize today's commits.",
    enabled: true,
    schedule: { type: "interval", everyMs: 60 * 60_000 },
    projectId: "project-runs",
    workspaceStrategy: { type: "root" },
    modelSelection: { instanceId: "codex", model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    ...(notify === undefined ? {} : { notify }),
  });

it.effect("follows a run from dispatch to the agent's finished turn", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-19T08:00:00Z")));
    const harness = makeHarness();
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const created = yield* service.upsert(yield* task("failures"));
      expect(created.task.notify).toBe("failures");

      yield* service.runNow({ id: created.task.id });
      const [working] = (yield* service.listRuns({ id: created.task.id })).runs;
      expect(working).toMatchObject({
        trigger: "manual",
        status: "working",
        threadId,
        finishedAt: null,
      });

      // The agent is still working: a scheduler tick leaves the run open.
      yield* TestClock.adjust("6 seconds");
      expect((yield* service.listRuns({ id: created.task.id })).runs[0]?.status).toBe("working");

      harness.state.runStatus = "completed";
      yield* TestClock.adjust("6 seconds");
      const [finished] = (yield* service.listRuns({ id: created.task.id })).runs;
      expect(finished?.status).toBe("succeeded");
      expect(finished?.finishedAt).not.toBeNull();
      // Clients apply the task's notify policy to the run it started.
      expect((yield* service.list()).tasks[0]?.recentRunIds).toEqual(["orchestration-run-1"]);
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("records a run whose prompt never went out, and an agent turn that failed", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-19T08:00:00Z")));
    const harness = makeHarness();
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const created = yield* service.upsert(yield* task());
      expect(created.task.notify).toBe("all");

      harness.state.failLaunch = true;
      yield* service.runNow({ id: created.task.id });
      const [failedDispatch] = (yield* service.listRuns({ id: created.task.id })).runs;
      expect(failedDispatch?.status).toBe("failed");
      expect(failedDispatch?.threadId).toBeNull();
      expect(failedDispatch?.error).toMatch(/The project is gone/);

      harness.state.failLaunch = false;
      yield* TestClock.adjust("1 second");
      yield* service.runNow({ id: created.task.id });
      harness.state.runStatus = "interrupted";
      yield* TestClock.adjust("6 seconds");
      const runs = (yield* service.listRuns({ id: created.task.id })).runs;
      expect(runs).toHaveLength(2);
      expect(runs[0]?.status).toBe("failed");
      expect(runs[0]?.error).toMatch(/interrupted/);

      yield* service.delete({ id: created.task.id });
      expect((yield* service.listRuns({ id: created.task.id })).runs).toEqual([]);
    }).pipe(Effect.provide(harness.layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
