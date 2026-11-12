import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  DEFAULT_ORBIT_CONFIG,
  ProjectId,
  ProviderInstanceId,
  type ScheduledTask,
  ScheduledTaskId,
  type ScheduledTaskRunRecord,
  type ScheduledTaskUpsertInput,
  ThreadId,
} from "@moonfold/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient } from "effect/http";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as OrbitService from "./OrbitService.ts";

const projectId = ProjectId.make("project-orbit");
const model = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" };

/** A scheduled task service that keeps what Orbit saves, and runs the tests set up. */
function fakeTasks() {
  type Saved = ScheduledTaskUpsertInput & { readonly id: ScheduledTaskId };
  const tasks = new Map<string, Saved>();
  const runs = new Map<string, Array<ScheduledTaskRunRecord>>();
  let next = 0;
  const asTask = (input: Saved) =>
    ({
      ...input,
      threadId: null,
      createdBy: "system",
      creationSource: "web",
      createdAt: "2026-11-12T00:00:00.000Z",
      updatedAt: "2026-11-12T00:00:00.000Z",
      nextRunAt: null,
      lastRunAt: null,
      lastRunStatus: "never",
      lastRunError: null,
      runCount: 0,
    }) as unknown as ScheduledTask;
  const service = {
    upsert: (input: ScheduledTaskUpsertInput) =>
      Effect.sync(() => {
        const id = input.id ?? ScheduledTaskId.make(`task-${next++}`);
        const saved = { ...input, id };
        tasks.set(id, saved);
        return { task: asTask(saved) };
      }),
    setEnabled: (input: { readonly id: ScheduledTaskId; readonly enabled: boolean }) =>
      Effect.sync(() => {
        const saved = { ...tasks.get(input.id)!, enabled: input.enabled };
        tasks.set(input.id, saved);
        return { task: asTask(saved) };
      }),
    list: () => Effect.sync(() => ({ tasks: [...tasks.values()].map(asTask) })),
    listRuns: (input: { readonly id: string }) =>
      Effect.sync(() => ({ runs: runs.get(input.id) ?? [] })),
    runNow: (input: { readonly id: ScheduledTaskId }) =>
      Effect.sync(() => ({ task: asTask(tasks.get(input.id)!), threadId: null })),
  } satisfies Partial<ScheduledTaskService.ScheduledTaskService["Service"]>;
  const byTitle = (title: string) => [...tasks.values()].find((task) => task.title === title);
  const addRun = (title: string, threadId: string, startedAt: string) => {
    const task = byTitle(title)!;
    runs.set(task.id, [
      {
        id: `run-${threadId}`,
        taskId: task.id,
        trigger: "scheduled",
        startedAt,
        finishedAt: null,
        status: "succeeded",
        threadId: ThreadId.make(threadId),
        error: null,
      },
      ...(runs.get(task.id) ?? []),
    ]);
  };
  return { service, byTitle, addRun };
}

function layerFor(tasks: ReturnType<typeof fakeTasks>) {
  return OrbitService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ScheduledTaskService.ScheduledTaskService)(tasks.service),
        Layer.mock(ProjectService.ProjectService)({
          getShell: () => Effect.succeedNone,
        }),
        ServerSettings.layerTest({ defaultModelSelection: model }),
        // These tests read no channels.
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("no network in tests")),
        ),
        SqlitePersistence.layerMemory,
        NodeCrypto.layer,
      ),
    ),
  );
}

const enabled = { ...DEFAULT_ORBIT_CONFIG, enabled: true };

it.effect("installs one task per role the level allows, and holds them for the stop switch", () => {
  const tasks = fakeTasks();
  return Effect.gen(function* () {
    const orbit = yield* OrbitService.OrbitService;
    const off = yield* orbit.get(projectId);
    assert.strictEqual(off.holdReason, "Orbit is off for this project.");

    const noMission = yield* orbit.update({ projectId, config: enabled });
    assert.strictEqual(noMission.holdReason, "Write the mission first.");
    assert.isFalse(tasks.byTitle("Orbit · Scout")!.enabled);

    const running = yield* orbit.update({ projectId, mission: "Make budgeting calm." });
    assert.isNull(running.holdReason);
    const scout = tasks.byTitle("Orbit · Scout")!;
    assert.isTrue(scout.enabled);
    assert.deepStrictEqual(scout.workspaceStrategy, { type: "root" });
    assert.strictEqual(scout.runtimeMode, "auto-accept-edits");
    // The builder changes code, in its own worktree.
    const builder = tasks.byTitle("Orbit · Builder")!;
    assert.deepStrictEqual(builder.workspaceStrategy, { type: "worktree", baseRef: "HEAD" });
    assert.strictEqual(builder.runtimeMode, "auto");
    assert.include(builder.prompt, "Never merge, release or post.");
    // The herald is off by default.
    assert.isUndefined(tasks.byTitle("Orbit · Herald"));

    // Observing turns the builder off and the sentinel to read-and-report.
    yield* orbit.update({ projectId, config: { ...enabled, level: "observe" } });
    assert.isFalse(tasks.byTitle("Orbit · Builder")!.enabled);
    assert.strictEqual(tasks.byTitle("Orbit · Sentinel")!.runtimeMode, "auto-accept-edits");

    const paused = yield* orbit.update({ projectId, paused: true });
    assert.strictEqual(paused.holdReason, "Paused by the owner.");
    assert.isFalse(tasks.byTitle("Orbit · Scout")!.enabled);
    assert.include(
      paused.audit.map((entry) => entry.detail),
      "paused",
    );
  }).pipe(Effect.provide(layerFor(tasks)));
});

it.effect("holds every role once the day's runs are used", () => {
  const tasks = fakeTasks();
  return Effect.gen(function* () {
    const orbit = yield* OrbitService.OrbitService;
    yield* orbit.update({
      projectId,
      config: { ...enabled, maxRunsPerDay: 2 },
      mission: "Make budgeting calm.",
    });
    const day = DateTime.formatIso(yield* DateTime.now).slice(0, 10);
    tasks.addRun("Orbit · Scout", "thread-a", `${day}T01:00:00.000Z`);
    tasks.addRun("Orbit · Planner", "thread-b", `${day}T02:00:00.000Z`);
    const held = yield* orbit.update({ projectId, mission: "Make budgeting calm." });
    assert.strictEqual(held.runsToday, 2);
    assert.include(held.holdReason ?? "", "budget of 2 runs");
    assert.isFalse(tasks.byTitle("Orbit · Scout")!.enabled);
    const refused = yield* Effect.flip(orbit.runNow(projectId, "scout"));
    assert.include(refused.message, "budget");
  }).pipe(Effect.provide(layerFor(tasks)));
});

it.effect("knows each run's role, and keeps the owner's requests ahead of the planner's", () => {
  const tasks = fakeTasks();
  return Effect.gen(function* () {
    const orbit = yield* OrbitService.OrbitService;
    yield* orbit.update({ projectId, config: enabled, mission: "Make budgeting calm." });
    const day = DateTime.formatIso(yield* DateTime.now).slice(0, 10);
    tasks.addRun("Orbit · Planner", "thread-planner", `${day}T01:00:00.000Z`);
    tasks.addRun("Orbit · Builder", "thread-builder", `${day}T02:00:00.000Z`);
    const planner = ThreadId.make("thread-planner");
    const builder = ThreadId.make("thread-builder");
    assert.strictEqual(yield* orbit.roleOf(planner, projectId), "planner");
    assert.isNull(yield* orbit.roleOf(ThreadId.make("thread-other"), projectId));

    yield* orbit.request(projectId, "Add a dark mode");
    yield* orbit.setBacklog(projectId, planner, [
      {
        title: "Fix the CSV import",
        why: "Three users hit it.",
        effort: "small",
        needsOwner: false,
      },
      { title: "Charge for exports", why: "Pricing.", effort: "small", needsOwner: true },
    ]);
    const snapshot = yield* orbit.get(projectId);
    // A pricing decision is the owner's: it became a question, not work.
    assert.isTrue(
      snapshot.items.some(
        (item) => item.kind === "question" && item.title === "Charge for exports",
      ),
    );
    const first = yield* orbit.takeBacklog(projectId, builder);
    assert.strictEqual(first?.title, "Add a dark mode");
    const second = yield* orbit.takeBacklog(projectId, builder);
    assert.strictEqual(second?.title, "Fix the CSV import");
    assert.isNull(yield* orbit.takeBacklog(projectId, builder));

    // A quiet run is filed as done, so the inbox shows only what needs a look.
    yield* orbit.report(projectId, "scout", planner, {
      title: "Nothing new",
      summary: "No new posts.",
      outcome: "nothing_to_do",
    });
    const quiet = (yield* orbit.get(projectId)).items.find(
      (item) => item.title === "Scout: Nothing new",
    );
    assert.strictEqual(quiet?.status, "done");
  }).pipe(Effect.provide(layerFor(tasks)));
});
