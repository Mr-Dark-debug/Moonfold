import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  ASK_USER_UNANSWERED_NOTE,
  EnvironmentId,
  NodeId,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ProviderInstanceId,
  type QuestionRequestAnswers,
  type QuestionRequestQuestion,
  RunId,
  ThreadId,
} from "@moonfold/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as RemoteDelegation from "../peer/RemoteDelegation.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import type * as McpInvocationContext from "./McpInvocationContext.ts";
import * as OrchestratorMcpService from "./OrchestratorMcpService.ts";

const threadId = ThreadId.make("thread-ask-user");
const projectId = ProjectId.make("project-ask-user");
const runId = RunId.make("run-ask-user");
const rootNodeId = NodeId.make("node-ask-user");
const instanceId = ProviderInstanceId.make("codex");
const now = DateTime.makeUnsafe("2026-11-06T12:00:00.000Z");

const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment-ask-user"),
  requestNamespace: "provider-session-ask-user",
  thread: {
    threadId,
    providerSessionId: "provider-session-ask-user",
    providerInstanceId: instanceId,
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

const question = (images?: ReadonlyArray<string>): QuestionRequestQuestion => ({
  id: "direction",
  header: "Direction",
  question: "Which direction should I take?",
  options: [
    { label: "Bold", value: "bold-v1", ...(images === undefined ? {} : { images }) },
    { label: "Calm", description: "Soft colors" },
  ],
});

interface CardState {
  /** What the user does once the card is recorded. */
  readonly onAsked: "answer" | "dismiss" | "wait" | "end_run";
  readonly answers?: QuestionRequestAnswers;
}

/** The service over a thread whose card the user handles as `state` says. */
const layerFor = (state: CardState, workspaceRoot = "/unused") => {
  const dispatched: Array<OrchestrationV2ServerCommand> = [];
  let questionStatus: "pending" | "answered" | "cancelled" | undefined;
  let runStatus: "running" | "completed" = "running";
  const projection = () => {
    const asked = dispatched.find((command) => command.type === "question_request.record");
    return {
      thread: {
        id: threadId,
        projectId,
        providerInstanceId: instanceId,
        worktreePath: workspaceRoot,
        runtimeMode: "full-access",
        interactionMode: "default",
        archivedAt: null,
        deletedAt: null,
      },
      runs: [
        {
          id: runId,
          ordinal: 1,
          status: runStatus,
          providerInstanceId: instanceId,
          rootNodeId,
          requestedAt: now,
          startedAt: now,
          completedAt: runStatus === "completed" ? now : null,
        },
      ],
      turnItems:
        asked?.type === "question_request.record" && questionStatus !== undefined
          ? [
              {
                type: "question_request",
                id: asked.turnItemId,
                questions: asked.questions,
                questionStatus,
                ...(questionStatus === "answered" ? { answers: state.answers } : {}),
              },
            ]
          : [],
      messages: [],
      providerThreads: [],
      providerTurns: [],
      runtimeRequests: [],
      contextTransfers: [],
    } as unknown as OrchestrationV2ThreadProjection;
  };
  const layer = OrchestratorMcpService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          getThreadRecords: () => Effect.sync(projection),
          getThreadShell: () =>
            Effect.sync(() => projection().thread as unknown as OrchestrationV2ThreadShell),
          dispatch: (command) =>
            Effect.sync(() => {
              dispatched.push(command);
              if (command.type !== "question_request.record") return {} as never;
              if (questionStatus === undefined || command.questionStatus === "cancelled") {
                questionStatus = command.questionStatus;
              }
              if (command.questionStatus === "pending") {
                if (state.onAsked === "answer") questionStatus = "answered";
                if (state.onAsked === "dismiss") questionStatus = "cancelled";
                if (state.onAsked === "end_run") runStatus = "completed";
              }
              return {} as never;
            }),
        } satisfies Partial<ThreadManagementService.ThreadManagementService["Service"]>),
        ServerSettings.layerTest(),
        Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
        Layer.mock(ProjectService.ProjectService)({}),
        Layer.mock(SecretRequests.SecretRequests)({}),
        Layer.mock(RemoteDelegation.RemoteDelegation)({}),
        Layer.mock(ScheduledTaskService.ScheduledTaskService)({}),
        Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({}),
        Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
        Layer.mock(GitVcsDriver.GitVcsDriver)({}),
        NodeCrypto.layer,
      ),
    ),
  );
  return { layer, dispatched };
};

/** A checkout holding one picture, and a picture outside it. */
const workspaceWithImage = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "moonfold-ask-user-" });
  const outside = yield* fileSystem.makeTempDirectoryScoped({ prefix: "moonfold-ask-user-out-" });
  const image = path.join(root, "bold.png");
  const stranger = path.join(outside, "elsewhere.png");
  yield* fileSystem.writeFile(image, new Uint8Array([137, 80, 78, 71]));
  yield* fileSystem.writeFile(stranger, new Uint8Array([137, 80, 78, 71]));
  yield* fileSystem.writeFileString(path.join(root, "notes.txt"), "not a picture");
  return { root, image, stranger, notes: path.join(root, "notes.txt") };
});

const askWith = (
  state: CardState,
  questions: ReadonlyArray<QuestionRequestQuestion>,
  root?: string,
) =>
  Effect.gen(function* () {
    const { layer, dispatched } = layerFor(state, root);
    const result = yield* Effect.gen(function* () {
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.askUser(scope, { title: "Pick one", questions });
    }).pipe(Effect.provide(layer));
    return { result, dispatched };
  });

it.layer(NodeServices.layer)("moonfold_ask_user", (it) => {
  it.effect("returns the labels and values the user picked", () =>
    Effect.gen(function* () {
      const { root, image } = yield* workspaceWithImage;
      const { result, dispatched } = yield* askWith(
        { onAsked: "answer", answers: { direction: { selected: ["Bold"] } } },
        [question([image])],
        root,
      );
      expect(result).toEqual({
        status: "answered",
        answers: { direction: { selected: [{ label: "Bold", value: "bold-v1" }] } },
      });
      expect(dispatched).toMatchObject([
        { type: "question_request.record", questionStatus: "pending", title: "Pick one" },
      ]);
    }),
  );

  it.effect("tells the agent when the user dismissed the card", () =>
    Effect.gen(function* () {
      const { result } = yield* askWith({ onAsked: "dismiss" }, [question()]);
      expect(result).toEqual({ status: "dismissed", note: ASK_USER_UNANSWERED_NOTE.dismissed });
    }),
  );

  it.effect("closes the card when the run ends first", () =>
    Effect.gen(function* () {
      const { result, dispatched } = yield* askWith({ onAsked: "end_run" }, [question()]);
      expect(result).toEqual({ status: "cancelled", note: ASK_USER_UNANSWERED_NOTE.cancelled });
      expect(
        dispatched.map((command) =>
          command.type === "question_request.record" ? command.questionStatus : command.type,
        ),
      ).toEqual(["pending", "cancelled"]);
    }),
  );

  it.effect("closes the card after 30 minutes without an answer", () =>
    Effect.gen(function* () {
      const { layer, dispatched } = layerFor({ onAsked: "wait" });
      const waiting = yield* Effect.gen(function* () {
        const service = yield* OrchestratorMcpService.OrchestratorMcpService;
        return yield* service.askUser(scope, { questions: [question()] });
      }).pipe(Effect.provide(layer), Effect.forkChild({ startImmediately: true }));
      yield* TestClock.adjust("29 minutes");
      // Still open: only the pending record so far.
      expect(dispatched).toHaveLength(1);
      yield* TestClock.adjust("2 minutes");
      expect(yield* Fiber.join(waiting)).toEqual({
        status: "timed_out",
        note: ASK_USER_UNANSWERED_NOTE.timed_out,
      });
      expect(dispatched.at(-1)).toMatchObject({ questionStatus: "cancelled" });
    }),
  );

  it.effect("refuses images that are missing, outside the workspace, or not pictures", () =>
    Effect.gen(function* () {
      const { root, stranger, notes } = yield* workspaceWithImage;
      for (const [image, expected] of [
        [stranger, "is outside this thread's workspace"],
        [`${root}/missing.png`, "does not exist"],
        [notes, "is not an image file"],
        ["bold.png", "is not an absolute path"],
      ] as const) {
        const { layer, dispatched } = layerFor({ onAsked: "answer" }, root);
        const refused = yield* Effect.gen(function* () {
          const service = yield* OrchestratorMcpService.OrchestratorMcpService;
          return yield* service.askUser(scope, { questions: [question([image])] });
        }).pipe(Effect.provide(layer), Effect.flip);
        expect(refused).toMatchObject({ code: "invalid_request" });
        expect(refused.message).toContain(expected);
        // Nothing reaches the thread for a card that cannot be shown.
        expect(dispatched).toEqual([]);
      }
    }),
  );
});
