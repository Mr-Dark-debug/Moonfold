import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  isRuntimeModeAbove,
  AgentSessionImportNotFoundError,
  AgentSessionImportProjectChangedError,
  AgentSessionImportProjectNotFoundError,
  AgentSessionImportSource,
  AgentSessionScanError,
  AgentSessionSource,
  EventId,
  MessageId,
  ProjectId,
  type ProviderInstanceId,
  ProviderDriverKind,
  ThreadId,
  TurnItemId,
  type AgentSessionImportInput,
  type AgentSessionImportResult,
  type AgentSessionImportSessionInput,
  type AgentSessionImportSessionResult,
  type AgentSessionListInput,
  type AgentSessionListResult,
  type AgentSessionLookupInput,
  type AgentSessionLookupResult,
  type AgentSessionSummary,
  type OrchestrationV2AppThread,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2TurnItem,
} from "@moonfold/contracts";
import { normalizeProjectPathForComparison } from "@moonfold/shared/path";
import { resolveProjectSettings } from "@moonfold/shared/projectSettings";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as IdAllocator from "@moonfold/provider-core/server/IdAllocator";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderSessionRuntime from "../persistence/ProviderSessionRuntime.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  resolveAntigravityProfileDir,
  stageAntigravitySessionDb,
  type AgentSessionTimelineItem,
} from "./AgentSessionRichTranscript.ts";
import * as AgentSessionScanner from "./AgentSessionScanner.ts";
import * as ProjectService from "./ProjectService.ts";

const IMPORT_EVENT_PREFIX = "agent-session-import:v2";
const CLAUDE_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const decodeImportedTranscriptPayload = Schema.decodeUnknownOption(
  Schema.Struct({
    cwd: Schema.optional(Schema.String),
    importedTranscripts: Schema.optional(Schema.Array(AgentSessionImportSource)),
  }),
);

class AgentSessionUnresumableSessionError extends Schema.TaggedError<AgentSessionUnresumableSessionError>()(
  "AgentSessionUnresumableSessionError",
  {
    source: AgentSessionSource,
    providerSessionId: Schema.String,
  },
) {
  override get message(): string {
    return `Session '${this.providerSessionId}' from '${this.source}' cannot be resumed.`;
  }
}

class AgentSessionThreadProjectConflictError extends Schema.TaggedError<AgentSessionThreadProjectConflictError>()(
  "AgentSessionThreadProjectConflictError",
  {
    threadId: ThreadId,
    expectedProjectId: ProjectId,
    actualProjectId: ProjectId,
  },
) {
  override get message(): string {
    return `Imported thread '${this.threadId}' belongs to project '${this.actualProjectId}', not '${this.expectedProjectId}'.`;
  }
}

class AgentSessionThreadModifiedError extends Schema.TaggedError<AgentSessionThreadModifiedError>()(
  "AgentSessionThreadModifiedError",
  { threadId: ThreadId },
) {
  override get message(): string {
    return `Imported thread '${this.threadId}' already contains non-imported activity.`;
  }
}

function dateTime(value: string): DateTime.Utc {
  return DateTime.makeUnsafe(value);
}

function messageEvents(input: {
  readonly threadId: ThreadId;
  readonly index: number;
  readonly message: AgentSessionScanner.AgentSessionThreadMessage;
}): ReadonlyArray<OrchestrationV2DomainEvent> {
  const ordinal = input.index + 1;
  const suffix = String(input.index).padStart(6, "0");
  const messageId = MessageId.make(`${input.threadId}:${suffix}`);
  const turnItemId = TurnItemId.make(
    `${IMPORT_EVENT_PREFIX}:turn-item:${input.threadId}:${suffix}`,
  );
  const at = dateTime(input.message.createdAt);
  const message: OrchestrationV2ConversationMessage = {
    createdBy: input.message.role === "user" ? "user" : "agent",
    creationSource: "server",
    id: messageId,
    threadId: input.threadId,
    runId: null,
    nodeId: null,
    role: input.message.role,
    text: input.message.text,
    attachments: [],
    streaming: false,
    createdAt: at,
    updatedAt: at,
  };
  const common = {
    id: turnItemId,
    threadId: input.threadId,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: "completed" as const,
    title: null,
    startedAt: at,
    completedAt: at,
    updatedAt: at,
  };
  const turnItem: OrchestrationV2TurnItem =
    input.message.role === "user"
      ? {
          ...common,
          createdBy: "user",
          creationSource: "server",
          type: "user_message",
          messageId,
          inputIntent: "turn_start",
          text: input.message.text,
          attachments: [],
        }
      : {
          ...common,
          type: "assistant_message",
          messageId,
          text: input.message.text,
          streaming: false,
        };
  return [
    {
      id: EventId.make(`${IMPORT_EVENT_PREFIX}:message:${input.threadId}:${suffix}`),
      type: "message.updated",
      threadId: input.threadId,
      occurredAt: at,
      payload: message,
    },
    {
      id: EventId.make(`${IMPORT_EVENT_PREFIX}:turn-item:${input.threadId}:${suffix}`),
      type: "turn-item.updated",
      threadId: input.threadId,
      occurredAt: at,
      payload: turnItem,
    },
  ];
}

function timelineItemEvents(input: {
  readonly threadId: ThreadId;
  readonly index: number;
  readonly item: AgentSessionTimelineItem;
}): ReadonlyArray<OrchestrationV2DomainEvent> {
  const { item } = input;
  if (item.kind === "user_message" || item.kind === "assistant_message") {
    return messageEvents({
      threadId: input.threadId,
      index: input.index,
      message: {
        role: item.kind === "user_message" ? "user" : "assistant",
        text: item.text,
        createdAt: item.createdAt,
      },
    });
  }

  const ordinal = input.index + 1;
  const suffix = String(input.index).padStart(6, "0");
  const turnItemId = TurnItemId.make(
    `${IMPORT_EVENT_PREFIX}:turn-item:${input.threadId}:${suffix}`,
  );
  const at = dateTime(item.createdAt);
  const base = {
    id: turnItemId,
    threadId: input.threadId,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    startedAt: at,
    completedAt: at,
    updatedAt: at,
  };

  let turnItem: OrchestrationV2TurnItem;
  switch (item.kind) {
    case "reasoning":
      turnItem = {
        ...base,
        status: "completed",
        title: null,
        type: "reasoning",
        text: item.text,
        streaming: false,
      };
      break;
    case "command_execution":
      turnItem = {
        ...base,
        status: item.status,
        title: null,
        type: "command_execution",
        input: item.input,
        ...(item.output === undefined ? {} : { output: item.output }),
        ...(item.status === "failed" ? { outputIndicatesFailure: true } : {}),
      };
      break;
    case "file_change":
      turnItem = {
        ...base,
        status: item.status,
        title: null,
        type: "file_change",
        fileName: item.fileName.trim() || "file",
        ...(item.oldStr === undefined ? {} : { oldStr: item.oldStr }),
        ...(item.newStr === undefined ? {} : { newStr: item.newStr }),
        ...(item.diffStr === undefined ? {} : { diffStr: item.diffStr }),
      };
      break;
    case "file_search":
      turnItem = {
        ...base,
        status: item.status,
        title: null,
        type: "file_search",
        ...(item.pattern === undefined ? {} : { pattern: item.pattern }),
      };
      break;
    case "web_search":
      turnItem = {
        ...base,
        status: item.status,
        title: null,
        type: "web_search",
        ...(item.patterns === undefined ? {} : { patterns: item.patterns }),
      };
      break;
    case "dynamic_tool":
      turnItem = {
        ...base,
        status: item.status,
        title: item.title ?? null,
        type: "dynamic_tool",
        toolName: item.toolName.trim() || null,
        input: item.input ?? {},
        ...(item.output === undefined ? {} : { output: item.output }),
      };
      break;
  }

  return [
    {
      id: EventId.make(`${IMPORT_EVENT_PREFIX}:turn-item:${input.threadId}:${suffix}`),
      type: "turn-item.updated",
      threadId: input.threadId,
      occurredAt: at,
      payload: turnItem,
    },
  ];
}

const make = Effect.gen(function* () {
  const scanner = yield* AgentSessionScanner.AgentSessionScanner;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projects = yield* ProjectService.ProjectService;
  const eventSink = yield* EventSink.EventSinkV2;
  const idAllocator = yield* IdAllocator.IdAllocatorV2;
  const runtimes = yield* ProviderSessionRuntime.ProviderSessionRuntimeRepository;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const serverConfigOption = yield* Effect.serviceOption(ServerConfig.ServerConfig);
  const ceiling = settingsService.managedPolicy?.limits?.maxRuntimeMode;
  const importRecentAgentThreads = Effect.fn("importRecentAgentThreadsV2")(function* (
    input: AgentSessionImportInput,
  ) {
    const project = yield* projects.getById(input.projectId).pipe(
      Effect.mapError((cause) => new AgentSessionScanError({ operation: "read-projects", cause })),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(new AgentSessionImportProjectNotFoundError({ projectId: input.projectId })),
          onSome: Effect.succeed,
        }),
      ),
    );
    if (
      input.expectedWorkspaceRoot !== undefined &&
      normalizeProjectPathForComparison(project.workspaceRoot) !==
        normalizeProjectPathForComparison(input.expectedWorkspaceRoot)
    ) {
      return yield* new AgentSessionImportProjectChangedError({ projectId: input.projectId });
    }
    // Imports run in full access, except under a policy ceiling: then in the project's default,
    // which the policy keeps under it, so imported threads never sit above the ceiling.
    const runtimeMode =
      ceiling === undefined
        ? DEFAULT_RUNTIME_MODE
        : yield* settingsService.getSettings.pipe(
            Effect.mapError(
              (cause) => new AgentSessionScanError({ operation: "read-settings", cause }),
            ),
            Effect.map((settings) => {
              const mode = resolveProjectSettings(settings, input.projectId, project).settings
                .defaultRuntimeMode;
              return isRuntimeModeAbove(mode, ceiling) ? ceiling : mode;
            }),
          );
    const runtimeRows = yield* runtimes
      .list()
      .pipe(
        Effect.mapError(
          (cause) => new AgentSessionScanError({ operation: "read-projects", cause }),
        ),
      );
    const completedSources = runtimeRows.flatMap((runtime) => {
      const payload = decodeImportedTranscriptPayload(runtime.runtimePayload);
      if (
        Option.isNone(payload) ||
        payload.value.cwd === undefined ||
        normalizeProjectPathForComparison(payload.value.cwd) !==
          normalizeProjectPathForComparison(project.workspaceRoot)
      ) {
        return [];
      }
      return payload.value.importedTranscripts ?? [];
    });
    const outcomes = scanner.recentThreads(project.workspaceRoot, completedSources);
    const importedThreadIds = new Set<ThreadId>();
    let importedCount = 0;
    let skippedCount = 0;

    yield* Stream.runForEach(outcomes, (outcome) =>
      Effect.gen(function* () {
        if (outcome._tag === "Skipped") {
          skippedCount += 1;
          return;
        }
        const source = outcome.source;
        const threadId = ThreadId.make(
          `import:${source.providerInstanceId}:${source.providerSessionId}`,
        );
        if (outcome._tag === "AlreadyImported") {
          importedThreadIds.add(threadId);
          importedCount += 1;
          return;
        }
        if (outcome._tag === "Duplicate") {
          if (importedThreadIds.has(threadId)) {
            yield* runtimes.recordImportedTranscript({ threadId, source }).pipe(Effect.ignore);
          }
          return;
        }

        const imported = yield* Effect.gen(function* () {
          const thread = outcome.thread;
          if (
            thread.source === "claudeAgent" &&
            !CLAUDE_SESSION_ID_PATTERN.test(thread.providerSessionId)
          ) {
            return yield* new AgentSessionUnresumableSessionError({
              source: thread.source,
              providerSessionId: thread.providerSessionId,
            });
          }
          const driver = ProviderDriverKind.make(thread.source);
          // Pi resumes by session file path; its session UUID only names the thread.
          const nativeThreadId =
            thread.source === "pi" ? source.filePath : thread.providerSessionId;
          const persistRuntime = runtimes.upsert(
            {
              threadId,
              providerName: driver,
              providerInstanceId: thread.providerInstanceId,
              adapterKey: driver,
              runtimeMode,
              status: "stopped",
              lastSeenAt: thread.updatedAt,
              resumeCursor:
                thread.source === "claudeAgent"
                  ? { threadId, resume: thread.providerSessionId }
                  : { threadId: nativeThreadId },
              runtimePayload: { cwd: project.workspaceRoot },
            },
            { onConflict: "ignore" },
          );
          const existing = yield* Effect.option(orchestrator.getThreadRecords(threadId, []));
          if (Option.isSome(existing)) {
            if (existing.value.thread.projectId !== input.projectId) {
              return yield* new AgentSessionThreadProjectConflictError({
                threadId,
                expectedProjectId: input.projectId,
                actualProjectId: existing.value.thread.projectId,
              });
            }
            if (existing.value.thread.historyOrigin !== "v1_import") {
              return yield* new AgentSessionThreadModifiedError({ threadId });
            }
            yield* persistRuntime;
            yield* runtimes.recordImportedTranscript({ threadId, source });
            return true;
          }

          const model = thread.model ?? DEFAULT_MODEL_BY_PROVIDER[driver] ?? DEFAULT_MODEL;
          const providerThreadId = idAllocator.derive.providerThread({
            driver,
            providerInstanceId: thread.providerInstanceId,
            nativeThreadId,
          });
          const createdAt = dateTime(thread.createdAt);
          const updatedAt = dateTime(thread.updatedAt);
          const appThread: OrchestrationV2AppThread = {
            createdBy: "system",
            creationSource: "server",
            id: threadId,
            projectId: input.projectId,
            title: thread.title.trim() === "" ? "Untitled thread" : thread.title,
            providerInstanceId: thread.providerInstanceId,
            modelSelection: { instanceId: thread.providerInstanceId, model },
            runtimeMode,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            linkedPullRequest: null,
            branchPullRequest: null,
            activeProviderThreadId: providerThreadId,
            historyOrigin: "v1_import",
            lineage: {
              parentThreadId: null,
              relationshipToParent: null,
              rootThreadId: threadId,
            },
            forkedFrom: null,
            createdAt,
            updatedAt,
            archivedAt: null,
            settledOverride: "settled",
            settledAt: updatedAt,
            unsettledAt: null,
            snoozedUntil: null,
            snoozedAt: null,
            pinnedAt: null,
            pinOrderKey: null,
            activeOrderKey: null,
            lastVisitedAt: null,
            deletedAt: null,
          };
          const providerThread: OrchestrationV2ProviderThread = {
            id: providerThreadId,
            driver,
            providerInstanceId: thread.providerInstanceId,
            providerSessionId: null,
            appThreadId: threadId,
            ownerNodeId: null,
            nativeThreadRef: {
              driver,
              nativeId: nativeThreadId,
              strength: "strong",
            },
            nativeConversationHeadRef: null,
            status: "idle",
            firstRunOrdinal: null,
            lastRunOrdinal: null,
            handoffIds: [],
            forkedFrom: null,
            pendingBackgroundTasks: [],
            createdAt,
            updatedAt,
          };

          const committed = yield* eventSink.write({
            unlessNativeThreadOwned: providerThread,
            events: [
              {
                id: EventId.make(`${IMPORT_EVENT_PREFIX}:thread:${threadId}:created`),
                type: "thread.created",
                threadId,
                providerInstanceId: thread.providerInstanceId,
                occurredAt: createdAt,
                payload: appThread,
              },
              ...(thread.omittedMessageCount > 0
                ? [
                    {
                      id: EventId.make(`${IMPORT_EVENT_PREFIX}:history-truncated:${threadId}`),
                      type: "turn-item.updated" as const,
                      threadId,
                      occurredAt: createdAt,
                      payload: {
                        id: TurnItemId.make(`${IMPORT_EVENT_PREFIX}:history-truncated:${threadId}`),
                        threadId,
                        runId: null,
                        nodeId: null,
                        providerThreadId: null,
                        providerTurnId: null,
                        nativeItemRef: null,
                        parentItemId: null,
                        ordinal: 0,
                        status: "completed" as const,
                        title: null,
                        startedAt: createdAt,
                        completedAt: createdAt,
                        updatedAt: createdAt,
                        type: "system_notice" as const,
                        message: `${thread.omittedMessageCount} earlier ${thread.omittedMessageCount === 1 ? "message was" : "messages were"} not imported. This thread keeps the first user message and the most recent history. The original session transcript is unchanged.`,
                      },
                    },
                  ]
                : []),
              ...thread.messages.flatMap((message, index) =>
                messageEvents({ threadId, index, message }),
              ),
              {
                id: EventId.make(`${IMPORT_EVENT_PREFIX}:provider-thread:${providerThreadId}`),
                type: "provider-thread.updated",
                threadId,
                driver,
                providerInstanceId: thread.providerInstanceId,
                occurredAt: updatedAt,
                payload: providerThread,
              },
            ],
          });
          if (committed.length === 0) return null;
          yield* persistRuntime;
          yield* runtimes.recordImportedTranscript({ threadId, source });
          return true;
        }).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Could not import an agent session", {
              provider: outcome.thread.source,
              sessionId: outcome.thread.providerSessionId,
              cause,
            }).pipe(Effect.as(false)),
          ),
        );
        if (imported === true) {
          importedThreadIds.add(threadId);
          importedCount += 1;
        } else if (imported === false) {
          skippedCount += 1;
        }
      }),
    );

    return { importedCount, skippedCount } satisfies AgentSessionImportResult;
  });

  const buildLookupMaps = Effect.fn("AgentSessionImporter.buildLookupMaps")(function* () {
    const [shells, runtimeRows] = yield* Effect.all([
      projects
        .listShells()
        .pipe(
          Effect.mapError(
            (cause) => new AgentSessionScanError({ operation: "read-projects", cause }),
          ),
        ),
      runtimes
        .list()
        .pipe(
          Effect.mapError(
            (cause) => new AgentSessionScanError({ operation: "read-projects", cause }),
          ),
        ),
    ]);
    const projectIdByRoot = new Map<string, ProjectId>();
    for (const shell of shells) {
      projectIdByRoot.set(normalizeProjectPathForComparison(shell.workspaceRoot), shell.id);
    }

    const importedThreadIdByKey = new Map<string, ThreadId>();
    for (const runtime of runtimeRows) {
      const payload = decodeImportedTranscriptPayload(runtime.runtimePayload);
      if (Option.isSome(payload) && payload.value.importedTranscripts) {
        for (const src of payload.value.importedTranscripts) {
          importedThreadIdByKey.set(
            `${src.providerInstanceId}\0${src.providerSessionId}`,
            runtime.threadId,
          );
          importedThreadIdByKey.set(`${src.provider}\0${src.providerSessionId}`, runtime.threadId);
        }
      }
      if (runtime.threadId.startsWith("import:")) {
        const prefix = `import:${runtime.providerInstanceId}:`;
        if (runtime.threadId.startsWith(prefix)) {
          const rest = runtime.threadId.slice(prefix.length);
          const sessionId = rest.split(":")[0];
          if (sessionId) {
            importedThreadIdByKey.set(
              `${runtime.providerInstanceId}\0${sessionId}`,
              runtime.threadId,
            );
            importedThreadIdByKey.set(`${runtime.providerName}\0${sessionId}`, runtime.threadId);
          }
        }
      }
    }

    return { projectIdByRoot, importedThreadIdByKey };
  });

  const resolveActiveImportedThreadId = Effect.fn(
    "AgentSessionImporter.resolveActiveImportedThreadId",
  )(function* (
    importedThreadIdByKey: ReadonlyMap<string, ThreadId>,
    provider: AgentSessionSource,
    providerInstanceId: ProviderInstanceId,
    sessionId: string,
  ) {
    const candidate =
      importedThreadIdByKey.get(`${providerInstanceId}\0${sessionId}`) ??
      importedThreadIdByKey.get(`${provider}\0${sessionId}`) ??
      ThreadId.make(`import:${providerInstanceId}:${sessionId}`);
    const existing = yield* Effect.option(orchestrator.getThreadRecords(candidate, []));
    if (Option.isSome(existing) && existing.value.thread.deletedAt === null) {
      return existing.value.thread.id;
    }
    return null;
  });

  const listSessions = Effect.fn("AgentSessionImporter.listSessions")(function* (
    input: AgentSessionListInput,
  ) {
    let workspaceRoot: string | undefined;
    if (input.projectId !== undefined) {
      const project = yield* projects
        .getById(input.projectId)
        .pipe(
          Effect.mapError(
            (cause) => new AgentSessionScanError({ operation: "read-projects", cause }),
          ),
        );
      if (Option.isSome(project)) {
        workspaceRoot = project.value.workspaceRoot;
      }
    }

    const [listed, lookupMaps] = yield* Effect.all([
      scanner.listSessions({
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      }),
      buildLookupMaps(),
    ]);

    const sessions: Array<AgentSessionSummary> = [];
    for (const item of listed.sessions) {
      const matchedProjectId =
        item.cwd === null
          ? null
          : (lookupMaps.projectIdByRoot.get(normalizeProjectPathForComparison(item.cwd)) ?? null);
      const alreadyImportedThreadId = yield* resolveActiveImportedThreadId(
        lookupMaps.importedThreadIdByKey,
        item.provider,
        item.providerInstanceId,
        item.sessionId,
      );
      sessions.push({
        provider: item.provider,
        providerInstanceId: item.providerInstanceId,
        sessionId: item.sessionId,
        title: item.title,
        cwd: item.cwd,
        model: item.model,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        alreadyImportedThreadId,
        matchedProjectId,
      });
    }

    return {
      sessions,
      ...(listed.truncated ? { truncated: true } : {}),
    } satisfies AgentSessionListResult;
  });

  const lookupSession = Effect.fn("AgentSessionImporter.lookupSession")(function* (
    input: AgentSessionLookupInput,
  ) {
    const [loaded, lookupMaps] = yield* Effect.all([
      scanner.loadRichSession({
        sessionId: input.sessionId,
        ...(input.provider === undefined ? {} : { provider: input.provider }),
      }),
      buildLookupMaps(),
    ]);

    if (Option.isNone(loaded)) {
      return { session: null } satisfies AgentSessionLookupResult;
    }

    const { thread } = loaded.value;
    const matchedProjectId =
      thread.cwd === null
        ? null
        : (lookupMaps.projectIdByRoot.get(normalizeProjectPathForComparison(thread.cwd)) ?? null);
    const alreadyImportedThreadId = yield* resolveActiveImportedThreadId(
      lookupMaps.importedThreadIdByKey,
      thread.source,
      thread.providerInstanceId,
      thread.providerSessionId,
    );

    return {
      session: {
        provider: thread.source,
        providerInstanceId: thread.providerInstanceId,
        sessionId: thread.providerSessionId,
        title: thread.title,
        cwd: thread.cwd,
        model: thread.model,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        alreadyImportedThreadId,
        matchedProjectId,
        messageCount: thread.messageCount,
        toolCallCount: thread.toolCallCount,
        reasoningCount: thread.reasoningCount,
        omittedItemCount: thread.omittedItemCount,
        firstUserPrompt: thread.firstUserPrompt,
      },
    } satisfies AgentSessionLookupResult;
  });

  const importSessionById = Effect.fn("AgentSessionImporter.importSessionById")(function* (
    input: AgentSessionImportSessionInput,
  ) {
    const project = yield* projects.getById(input.projectId).pipe(
      Effect.mapError((cause) => new AgentSessionScanError({ operation: "read-projects", cause })),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(new AgentSessionImportProjectNotFoundError({ projectId: input.projectId })),
          onSome: Effect.succeed,
        }),
      ),
    );

    const runtimeMode =
      ceiling === undefined
        ? DEFAULT_RUNTIME_MODE
        : yield* settingsService.getSettings.pipe(
            Effect.mapError(
              (cause) => new AgentSessionScanError({ operation: "read-settings", cause }),
            ),
            Effect.map((settings) => {
              const mode = resolveProjectSettings(settings, input.projectId, project).settings
                .defaultRuntimeMode;
              return isRuntimeModeAbove(mode, ceiling) ? ceiling : mode;
            }),
          );

    const loaded = yield* scanner.loadRichSession({
      sessionId: input.sessionId,
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.providerInstanceId === undefined
        ? {}
        : { providerInstanceId: input.providerInstanceId }),
    });
    if (Option.isNone(loaded)) {
      return yield* new AgentSessionImportNotFoundError({
        sessionId: input.sessionId,
        ...(input.provider === undefined ? {} : { provider: input.provider }),
      });
    }

    const { thread, source } = loaded.value;
    const driver = ProviderDriverKind.make(thread.source);
    const nativeThreadId = thread.source === "pi" ? source.filePath : thread.providerSessionId;
    const canonicalThreadId = ThreadId.make(
      `import:${thread.providerInstanceId}:${thread.providerSessionId}`,
    );

    const existing = yield* Effect.option(orchestrator.getThreadRecords(canonicalThreadId, []));
    if (Option.isSome(existing) && existing.value.thread.deletedAt === null) {
      return {
        threadId: canonicalThreadId,
        imported: false,
        alreadyImported: true,
        provider: thread.source,
        title: existing.value.thread.title,
        messageCount: thread.messageCount,
        toolCallCount: thread.toolCallCount,
        reasoningCount: thread.reasoningCount,
        omittedItemCount: thread.omittedItemCount,
      } satisfies AgentSessionImportSessionResult;
    }

    const isReimport = Option.isSome(existing);
    const reimportSuffix = isReimport
      ? `:${(yield* Clock.currentTimeMillis).toString(36).slice(-8)}`
      : "";
    const threadId = isReimport
      ? ThreadId.make(`${canonicalThreadId}${reimportSuffix}`)
      : canonicalThreadId;

    // Stage Antigravity SQLite DB into Moonfold's instance profile for native ACP resume.
    if (
      thread.source === "antigravity" &&
      thread.antigravityDbPath !== undefined &&
      Option.isSome(serverConfigOption)
    ) {
      const targetProfileDir = resolveAntigravityProfileDir(
        serverConfigOption.value.stateDir,
        thread.providerInstanceId,
      );
      yield* Effect.tryPromise({
        try: () =>
          stageAntigravitySessionDb({
            sourceDbPath: thread.antigravityDbPath!,
            targetProfileDir,
            sessionId: thread.providerSessionId,
            cwd: project.workspaceRoot,
          }),
        catch: (cause) =>
          new AgentSessionScanner.TranscriptParseError({
            filePath: thread.antigravityDbPath!,
            cause,
          }),
      }).pipe(Effect.ignore);
    }

    const model = thread.model ?? DEFAULT_MODEL_BY_PROVIDER[driver] ?? DEFAULT_MODEL;
    const providerThreadId = idAllocator.derive.providerThread({
      driver,
      providerInstanceId: thread.providerInstanceId,
      nativeThreadId: isReimport ? `${nativeThreadId}${reimportSuffix}` : nativeThreadId,
    });
    const createdAt = dateTime(thread.createdAt);
    const updatedAt = dateTime(thread.updatedAt);
    const title = thread.title.trim() === "" ? "Untitled thread" : thread.title.trim();

    const appThread: OrchestrationV2AppThread = {
      createdBy: "system",
      creationSource: "server",
      id: threadId,
      projectId: input.projectId,
      title,
      providerInstanceId: thread.providerInstanceId,
      modelSelection: { instanceId: thread.providerInstanceId, model },
      runtimeMode,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      linkedPullRequest: null,
      branchPullRequest: null,
      activeProviderThreadId: providerThreadId,
      historyOrigin: "v1_import",
      lineage: {
        parentThreadId: null,
        relationshipToParent: null,
        rootThreadId: threadId,
      },
      forkedFrom: null,
      createdAt,
      updatedAt,
      archivedAt: null,
      settledOverride: "settled",
      settledAt: updatedAt,
      unsettledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      pinnedAt: null,
      pinOrderKey: null,
      activeOrderKey: null,
      lastVisitedAt: null,
      deletedAt: null,
    };

    const providerThread: OrchestrationV2ProviderThread = {
      id: providerThreadId,
      driver,
      providerInstanceId: thread.providerInstanceId,
      providerSessionId: null,
      appThreadId: threadId,
      ownerNodeId: null,
      nativeThreadRef: {
        driver,
        nativeId: nativeThreadId,
        strength: "strong",
      },
      nativeConversationHeadRef: null,
      status: "idle",
      firstRunOrdinal: null,
      lastRunOrdinal: null,
      handoffIds: [],
      forkedFrom: null,
      pendingBackgroundTasks: [],
      createdAt,
      updatedAt,
    };

    const events: Array<OrchestrationV2DomainEvent> = [
      {
        id: EventId.make(`${IMPORT_EVENT_PREFIX}:thread:${threadId}:created`),
        type: "thread.created",
        threadId,
        providerInstanceId: thread.providerInstanceId,
        occurredAt: createdAt,
        payload: appThread,
      },
      ...(thread.omittedItemCount > 0
        ? [
            {
              id: EventId.make(`${IMPORT_EVENT_PREFIX}:history-truncated:${threadId}`),
              type: "turn-item.updated" as const,
              threadId,
              occurredAt: createdAt,
              payload: {
                id: TurnItemId.make(`${IMPORT_EVENT_PREFIX}:history-truncated:${threadId}`),
                threadId,
                runId: null,
                nodeId: null,
                providerThreadId: null,
                providerTurnId: null,
                nativeItemRef: null,
                parentItemId: null,
                ordinal: 0,
                status: "completed" as const,
                title: null,
                startedAt: createdAt,
                completedAt: createdAt,
                updatedAt: createdAt,
                type: "system_notice" as const,
                message: `${thread.omittedItemCount} earlier ${thread.omittedItemCount === 1 ? "item was" : "items were"} not imported. This thread keeps the opening prompt and the most recent history. The original session transcript is unchanged.`,
              },
            },
          ]
        : []),
      ...thread.items.flatMap((item, index) => timelineItemEvents({ threadId, index, item })),
      {
        id: EventId.make(`${IMPORT_EVENT_PREFIX}:provider-thread:${providerThreadId}`),
        type: "provider-thread.updated",
        threadId,
        driver,
        providerInstanceId: thread.providerInstanceId,
        occurredAt: updatedAt,
        payload: providerThread,
      },
    ];

    const committed = yield* eventSink
      .write(isReimport ? { events } : { unlessNativeThreadOwned: providerThread, events })
      .pipe(
        Effect.mapError(
          (cause) => new AgentSessionScanError({ operation: "read-projects", cause }),
        ),
      );

    if (committed.length === 0) {
      const lookupMaps = yield* buildLookupMaps();
      const existingThreadId = yield* resolveActiveImportedThreadId(
        lookupMaps.importedThreadIdByKey,
        thread.source,
        thread.providerInstanceId,
        thread.providerSessionId,
      );
      return {
        threadId: existingThreadId ?? canonicalThreadId,
        imported: false,
        alreadyImported: true,
        provider: thread.source,
        title,
        messageCount: thread.messageCount,
        toolCallCount: thread.toolCallCount,
        reasoningCount: thread.reasoningCount,
        omittedItemCount: thread.omittedItemCount,
      } satisfies AgentSessionImportSessionResult;
    }

    yield* runtimes
      .upsert(
        {
          threadId,
          providerName: driver,
          providerInstanceId: thread.providerInstanceId,
          adapterKey: driver,
          runtimeMode,
          status: "stopped",
          lastSeenAt: thread.updatedAt,
          resumeCursor:
            thread.source === "claudeAgent"
              ? { threadId, resume: thread.providerSessionId }
              : { threadId: nativeThreadId },
          runtimePayload: { cwd: project.workspaceRoot },
        },
        { onConflict: "ignore" },
      )
      .pipe(Effect.ignore);
    yield* runtimes.recordImportedTranscript({ threadId, source }).pipe(Effect.ignore);

    return {
      threadId,
      imported: true,
      alreadyImported: false,
      provider: thread.source,
      title,
      messageCount: thread.messageCount,
      toolCallCount: thread.toolCallCount,
      reasoningCount: thread.reasoningCount,
      omittedItemCount: thread.omittedItemCount,
    } satisfies AgentSessionImportSessionResult;
  });

  return { importRecentAgentThreads, listSessions, lookupSession, importSessionById };
});

type AgentSessionImporterShape = Effect.Success<typeof make>;

export class AgentSessionImporter extends Context.Service<
  AgentSessionImporter,
  AgentSessionImporterShape
>()("moonfold/project/AgentSessionImporter") {}

export const layer = Layer.effect(AgentSessionImporter, make);
