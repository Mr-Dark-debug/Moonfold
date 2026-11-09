import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  type QuestionRequestQuestion,
  RunId,
  ThreadId,
  TurnItemId,
} from "@moonfold/contracts";
import type * as ProviderAdapter from "@moonfold/provider-core/server/ProviderAdapter";
import * as ProviderContinuationRequests from "@moonfold/provider-core/server/ProviderContinuationRequests";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as QuestionRequests from "./QuestionRequests.ts";

const instanceId = ProviderInstanceId.make("codex");
const driver = ProviderDriverKind.make("codex");
const modelSelection = { instanceId, model: "gpt-5.4" };
const threadId = ThreadId.make("thread:questions");
const runId = RunId.make("run:questions");
const rootNode = NodeId.make("node:questions:root");
const providerThreadId = ProviderThreadId.make("provider-thread:questions");

const questions: ReadonlyArray<QuestionRequestQuestion> = [
  {
    id: "count",
    header: "Designs",
    question: "How many designs should I make?",
    options: [{ label: "Two" }, { label: "Three", value: "3" }],
  },
  {
    id: "name",
    header: "Name",
    question: "Which name do you like?",
    allowCustomAnswer: true,
    options: [{ label: "Lumen" }, { label: "Tide" }],
  },
];

const adapter = {
  instanceId,
  driver,
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

/** A real orchestrator and the answer service the card's RPC calls. */
const makeHarness = Effect.gen(function* () {
  const database = yield* SqlitePersistence.layerMemory.pipe(Layer.build);
  const layerDatabase = Layer.succeedContext(database);
  const layerOrchestrator = Layer.mergeAll(
    layerDatabase,
    ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
    ProviderReplayHarness.layerWithRegistry(
      { name: "question-requests" },
      ProviderAdapterRegistry.layerFromAdapters([adapter]),
      { databaseLayer: layerDatabase, runEffectWorker: false },
    ),
  ).pipe(
    Layer.provide(
      Layer.succeed(ProviderContinuationRequests.ProviderContinuationRequests, {
        offer: () => Effect.void,
        take: Effect.never,
      }),
    ),
  );
  const layerHere = QuestionRequests.layer.pipe(
    Layer.provideMerge(
      ThreadManagement.layer.pipe(
        Layer.provide(CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase))),
        Layer.provideMerge(Layer.merge(layerOrchestrator, ServerSettings.layerTest())),
      ),
    ),
    Layer.provide(NodeServices.layer),
    Layer.fresh,
  );
  const here = yield* Layer.build(layerHere);
  return {
    requests: Context.get(here, QuestionRequests.QuestionRequests),
    orchestrator: Context.get(here, Orchestrator.OrchestratorV2),
    sink: Context.get(here, EventSink.EventSinkV2),
  };
});
type Harness = Effect.Success<typeof makeHarness>;

/** A thread mid-turn, where an agent can ask. */
const seedThread = (h: Harness) =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    yield* h.orchestrator.dispatch({
      type: "thread.create",
      createdBy: "user",
      creationSource: "web",
      commandId: CommandId.make("command:create:questions"),
      threadId,
      projectId: ProjectId.make("project:questions"),
      title: "Questions",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
    });
    yield* h.sink.write({
      commandId: CommandId.make("command:seed:questions"),
      events: [
        {
          id: EventId.make("event:seed-node"),
          type: "node.updated",
          threadId,
          runId,
          nodeId: rootNode,
          driver,
          providerInstanceId: instanceId,
          occurredAt: now,
          payload: {
            id: rootNode,
            threadId,
            runId,
            parentNodeId: null,
            rootNodeId: rootNode,
            kind: "root_turn",
            status: "running",
            countsForRun: true,
            providerThreadId,
            providerTurnId: null,
            nativeItemRef: null,
            runtimeRequestId: null,
            checkpointScopeId: null,
            startedAt: now,
            completedAt: null,
          },
        },
        {
          id: EventId.make("event:seed-run"),
          type: "run.updated",
          threadId,
          runId,
          nodeId: rootNode,
          providerInstanceId: instanceId,
          occurredAt: now,
          payload: {
            id: runId,
            threadId,
            ordinal: 1,
            providerInstanceId: instanceId,
            modelSelection,
            providerThreadId,
            userMessageId: MessageId.make("message:seed-user"),
            rootNodeId: rootNode,
            activeAttemptId: null,
            status: "running",
            requestedAt: now,
            startedAt: now,
            completedAt: null,
            checkpointId: null,
            contextHandoffId: null,
          },
        },
      ],
    });
  });

const ask = (h: Harness, key: string, cardQuestions = questions) =>
  Effect.gen(function* () {
    const turnItemId = TurnItemId.make(`turn-item:question-request:${key}`);
    yield* h.orchestrator.dispatch({
      type: "question_request.record",
      commandId: CommandId.make(`command:ask:${key}`),
      threadId,
      runId,
      nodeId: rootNode,
      turnItemId,
      title: "Pick a direction",
      questions: cardQuestions,
      questionStatus: "pending",
    });
    return turnItemId;
  });

const cardOf = (h: Harness, turnItemId: TurnItemId) =>
  h.orchestrator
    .getThreadProjection(threadId)
    .pipe(Effect.map((projection) => projection.turnItems.find((item) => item.id === turnItemId)));

it.effect("a pending card waits on the user, and an answer records the choices once", () =>
  Effect.gen(function* () {
    const h = yield* makeHarness;
    yield* seedThread(h);
    const card = yield* ask(h, "one");
    expect(yield* cardOf(h, card)).toMatchObject({
      type: "question_request",
      status: "waiting",
      questionStatus: "pending",
      title: "Pick a direction",
    });
    // The thread asks for input while the card waits, as a secret card does.
    expect((yield* h.orchestrator.getThreadShell(threadId))?.pendingRuntimeRequest).toMatchObject({
      kind: "user_input",
    });

    yield* h.requests.answer({
      threadId,
      turnItemId: card,
      answer: {
        type: "submit",
        answers: {
          count: { selected: ["Three"] },
          name: { selected: [], custom: "  Harbor  " },
        },
      },
    });
    expect(yield* cardOf(h, card)).toMatchObject({
      status: "completed",
      questionStatus: "answered",
      answers: { count: { selected: ["Three"] }, name: { selected: [], custom: "Harbor" } },
    });
    expect((yield* h.orchestrator.getThreadShell(threadId))?.pendingRuntimeRequest).toBeNull();

    const late = yield* h.requests
      .answer({ threadId, turnItemId: card, answer: { type: "dismiss" } })
      .pipe(Effect.flip);
    expect(late.reason).toBe("already_answered");
    // A retried ask finds the card as it was answered.
    yield* ask(h, "one");
    expect(yield* cardOf(h, card)).toMatchObject({ questionStatus: "answered" });
  }),
);

it.effect("an answer that does not fit the questions leaves the card pending", () =>
  Effect.gen(function* () {
    const h = yield* makeHarness;
    yield* seedThread(h);
    const card = yield* ask(h, "two");
    const answerWith = (answers: Record<string, { selected: Array<string>; custom?: string }>) =>
      h.requests
        .answer({ threadId, turnItemId: card, answer: { type: "submit", answers } })
        .pipe(Effect.flip);

    const missing = yield* answerWith({ count: { selected: ["Two"] } });
    expect(missing).toMatchObject({ reason: "invalid_answer", message: 'Answer "Name".' });
    const stray = yield* answerWith({
      count: { selected: ["Four"] },
      name: { selected: ["Tide"] },
    });
    expect(stray.message).toBe('"Four" is not a choice for "Designs".');
    const twoChoices = yield* answerWith({
      count: { selected: ["Two", "Three"] },
      name: { selected: ["Tide"] },
    });
    expect(twoChoices.message).toBe('"Designs" takes one choice.');
    const noCustom = yield* answerWith({
      count: { selected: [], custom: "Ten" },
      name: { selected: ["Tide"] },
    });
    expect(noCustom.message).toBe('"Designs" takes only the listed choices.');

    // The orchestrator refuses the same answer even without the service in front.
    const direct = yield* h.orchestrator
      .dispatch({
        type: "question_request.record",
        commandId: CommandId.make("command:direct-answer"),
        threadId,
        runId,
        nodeId: rootNode,
        turnItemId: card,
        questions,
        questionStatus: "answered",
        answers: { count: { selected: ["Four"] }, name: { selected: ["Tide"] } },
      })
      .pipe(Effect.flip);
    expect(String(direct.cause)).toContain('"Four" is not a choice');
    expect(yield* cardOf(h, card)).toMatchObject({ status: "waiting", questionStatus: "pending" });
  }),
);

it.effect("dismissing closes the card, and a card with clashing labels is never asked", () =>
  Effect.gen(function* () {
    const h = yield* makeHarness;
    yield* seedThread(h);
    const card = yield* ask(h, "three");
    yield* h.requests.answer({ threadId, turnItemId: card, answer: { type: "dismiss" } });
    const dismissed = yield* cardOf(h, card);
    expect(dismissed).toMatchObject({ status: "cancelled", questionStatus: "cancelled" });
    expect(dismissed !== undefined && "answers" in dismissed).toBe(false);

    const clash = yield* ask(h, "four", [
      { ...questions[0]!, options: [{ label: "Two" }, { label: "Two" }] },
    ]).pipe(Effect.flip);
    expect(String(clash.cause)).toContain('two options labelled "Two"');
    const missing = yield* h.requests
      .answer({
        threadId,
        turnItemId: TurnItemId.make("turn-item:question-request:never"),
        answer: { type: "dismiss" },
      })
      .pipe(Effect.flip);
    expect(missing.reason).toBe("not_found");
  }),
);
