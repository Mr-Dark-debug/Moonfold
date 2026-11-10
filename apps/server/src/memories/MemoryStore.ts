/**
 * MemoryStore - short notes every agent turn receives, for all projects or one. The user writes
 * them in settings; agents save one through the `remember` MCP tool when asked, or propose one
 * after a correction (D-68). Memories can be turned off as a whole or for one thread.
 */
import {
  type Memory,
  MemoryError,
  MemoryId,
  type MemoryKind,
  type MemoryLearning,
  type MemoryListResult,
  type MemorySetThreadOptOutInput,
  type MemoryThreadStatus,
  type MemoryUpsertInput,
  ProjectId,
  ThreadId,
} from "@moonfold/contracts";
import type { TurnMemories } from "@moonfold/provider-core/server/memoryInstructions";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

/** How many memories an environment keeps; each one costs every turn some context. */
const MAX_MEMORIES = 200;

/** Upper bound on the memory text one turn receives, per kind, so a long list stays cheap. */
const MAX_TURN_MEMORY_CHARS = 6_000;

interface MemoryRow {
  readonly memory_id: string;
  readonly text: string;
  readonly project_id: string | null;
  readonly source: string;
  readonly thread_id: string | null;
  readonly kind: string;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
}

const toMemory = (row: MemoryRow): Memory => ({
  id: MemoryId.make(row.memory_id),
  text: row.text,
  projectId: row.project_id === null ? null : ProjectId.make(row.project_id),
  kind: row.kind === "environment" ? "environment" : "preference",
  status: row.status === "suggested" ? "suggested" : "active",
  source: row.source === "agent" ? "agent" : "user",
  threadId: row.thread_id === null ? null : ThreadId.make(row.thread_id),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// Credential shapes a memory must never hold: it is sent to providers on every turn.
const SECRET_SHAPES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:api[_-]?key|token|password|passwd|secret)\b\s*[:=]\s*[^\s"']{8,}/i,
];
const looksLikeSecret = (text: string) => SECRET_SHAPES.some((shape) => shape.test(text));

const memoryError = (message: string) => (cause: unknown) => new MemoryError({ message, cause });

/** Keeps memories in order until their combined text reaches the limit. */
function withinBudget(texts: ReadonlyArray<string>): ReadonlyArray<string> {
  const kept: Array<string> = [];
  let used = 0;
  for (const text of texts) {
    used += text.length;
    if (used > MAX_TURN_MEMORY_CHARS) break;
    kept.push(text);
  }
  return kept;
}

export class MemoryStore extends Context.Service<
  MemoryStore,
  {
    readonly list: Effect.Effect<MemoryListResult, MemoryError>;
    readonly upsert: (input: MemoryUpsertInput) => Effect.Effect<Memory, MemoryError>;
    readonly remove: (id: MemoryId) => Effect.Effect<void, MemoryError>;
    readonly setEnabled: (enabled: boolean) => Effect.Effect<void, MemoryError>;
    readonly setLearning: (learning: MemoryLearning) => Effect.Effect<void, MemoryError>;
    readonly threadStatus: (threadId: ThreadId) => Effect.Effect<MemoryThreadStatus, MemoryError>;
    readonly setThreadOptOut: (
      input: MemorySetThreadOptOutInput,
    ) => Effect.Effect<MemoryThreadStatus, MemoryError>;
    /** Saves what an agent was asked to remember. Refused while memories are off. */
    readonly remember: (input: {
      readonly text: string;
      readonly projectId: ProjectId | null;
      readonly threadId: ThreadId;
      readonly kind?: MemoryKind | undefined;
      /** True when the agent learned it from a correction, not from a request to remember. */
      readonly learned?: boolean | undefined;
    }) => Effect.Effect<Memory, MemoryError>;
    /** What one turn of the thread receives, or undefined when memories are off for it. */
    readonly forTurn: (input: {
      readonly threadId: ThreadId;
      readonly projectId: ProjectId;
    }) => Effect.Effect<TurnMemories | undefined, MemoryError>;
  }
>()("moonfold/memories/MemoryStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const random = yield* SecureRandom.SecureRandom;
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  // Memories are on until the user turns them off; nothing is delivered until one exists.
  const readEnabled = sql<{ readonly value: string }>`
    SELECT value FROM memory_settings WHERE key = 'enabled'
  `.pipe(Effect.map((rows) => rows[0]?.value !== "false"));

  // Until the user chooses, what an agent learns unasked waits as a suggestion.
  const readLearning = sql<{ readonly value: string }>`
    SELECT value FROM memory_settings WHERE key = 'learning'
  `.pipe(
    Effect.map((rows): MemoryLearning => {
      const value = rows[0]?.value;
      return value === "off" || value === "auto" ? value : "suggest";
    }),
  );

  const readMemory = (id: string) =>
    sql<MemoryRow>`SELECT * FROM memories WHERE memory_id = ${id}`.pipe(
      Effect.map((rows) => rows[0]),
    );

  const insert = Effect.fn("MemoryStore.insert")(function* (input: {
    readonly text: string;
    readonly projectId: ProjectId | null;
    readonly source: "user" | "agent";
    readonly threadId: ThreadId | null;
    readonly kind?: MemoryKind | undefined;
    readonly status?: Memory["status"] | undefined;
  }) {
    if (looksLikeSecret(input.text)) {
      return yield* new MemoryError({
        message:
          "This looks like it holds a password, key or token, so it was not saved. Memories are sent to agents on every turn; keep secrets out of them.",
      });
    }
    const [count] = yield* sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM memories`;
    if ((count?.count ?? 0) >= MAX_MEMORIES) {
      return yield* new MemoryError({
        message: `Moonfold keeps up to ${MAX_MEMORIES} memories. Delete one before adding another.`,
      });
    }
    const id = yield* random.uuidV4();
    const timestamp = yield* now;
    yield* sql`
      INSERT INTO memories
        (memory_id, text, project_id, source, thread_id, kind, status, created_at, updated_at)
      VALUES (${id}, ${input.text}, ${input.projectId}, ${input.source}, ${input.threadId},
        ${input.kind ?? "preference"}, ${input.status ?? "active"}, ${timestamp}, ${timestamp})
    `;
    const row = yield* readMemory(id);
    if (row === undefined) return yield* new MemoryError({ message: "The memory was not saved." });
    return toMemory(row);
  });

  const list: MemoryStore["Service"]["list"] = Effect.gen(function* () {
    const rows = yield* sql<MemoryRow>`SELECT * FROM memories ORDER BY created_at ASC`;
    return {
      enabled: yield* readEnabled,
      learning: yield* readLearning,
      memories: rows.map(toMemory),
    };
  }).pipe(Effect.mapError(memoryError("Could not read memories.")));

  const upsert: MemoryStore["Service"]["upsert"] = Effect.fn("MemoryStore.upsert")(
    function* (input) {
      if (input.id === undefined) {
        return yield* insert({
          text: input.text,
          projectId: input.projectId,
          source: "user",
          threadId: null,
          kind: input.kind,
        });
      }
      const existing = yield* readMemory(input.id);
      if (existing === undefined) {
        return yield* new MemoryError({ message: "This memory no longer exists." });
      }
      if (looksLikeSecret(input.text)) {
        return yield* new MemoryError({
          message:
            "This looks like it holds a password, key or token, so it was not saved. Keep secrets out of memories.",
        });
      }
      // An edited or accepted memory is the user's own words now, so it is followed like one.
      yield* sql`
        UPDATE memories
        SET text = ${input.text}, project_id = ${input.projectId}, source = 'user',
          status = 'active', kind = ${input.kind ?? existing.kind},
          updated_at = ${yield* now}
        WHERE memory_id = ${input.id}
      `;
      const row = yield* readMemory(input.id);
      if (row === undefined) {
        return yield* new MemoryError({ message: "This memory no longer exists." });
      }
      return toMemory(row);
    },
    Effect.catchTags({
      SqlError: (cause) =>
        Effect.fail(new MemoryError({ message: "Could not save the memory.", cause })),
    }),
  );

  const remove: MemoryStore["Service"]["remove"] = (id) =>
    sql`DELETE FROM memories WHERE memory_id = ${id}`.pipe(
      Effect.asVoid,
      Effect.mapError(memoryError("Could not delete the memory.")),
    );

  const setEnabled: MemoryStore["Service"]["setEnabled"] = (enabled) =>
    sql`
      INSERT INTO memory_settings (key, value) VALUES ('enabled', ${enabled ? "true" : "false"})
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `.pipe(Effect.asVoid, Effect.mapError(memoryError("Could not change memories.")));

  const setLearning: MemoryStore["Service"]["setLearning"] = (learning) =>
    sql`
      INSERT INTO memory_settings (key, value) VALUES ('learning', ${learning})
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `.pipe(Effect.asVoid, Effect.mapError(memoryError("Could not change memories.")));

  const isOptedOut = (threadId: ThreadId) =>
    sql<{ readonly thread_id: string }>`
      SELECT thread_id FROM memory_thread_opt_outs WHERE thread_id = ${threadId}
    `.pipe(Effect.map((rows) => rows.length > 0));

  const threadStatus: MemoryStore["Service"]["threadStatus"] = (threadId) =>
    isOptedOut(threadId).pipe(
      Effect.map((optedOut) => ({ threadId, optedOut })),
      Effect.mapError(memoryError("Could not read the thread's memory setting.")),
    );

  const setThreadOptOut: MemoryStore["Service"]["setThreadOptOut"] = Effect.fn(
    "MemoryStore.setThreadOptOut",
  )(
    function* (input) {
      if (input.optedOut) {
        yield* sql`
          INSERT INTO memory_thread_opt_outs (thread_id, created_at)
          VALUES (${input.threadId}, ${yield* now})
          ON CONFLICT (thread_id) DO NOTHING
        `;
      } else {
        yield* sql`DELETE FROM memory_thread_opt_outs WHERE thread_id = ${input.threadId}`;
      }
      return { threadId: input.threadId, optedOut: input.optedOut };
    },
    Effect.mapError(memoryError("Could not change the thread's memory setting.")),
  );

  const remember: MemoryStore["Service"]["remember"] = Effect.fn("MemoryStore.remember")(
    function* (input) {
      if (!(yield* readEnabled)) {
        return yield* new MemoryError({
          message:
            "Memories are turned off in Moonfold, so nothing was saved. The user can turn them on in Settings → Memories.",
        });
      }
      if (yield* isOptedOut(input.threadId)) {
        return yield* new MemoryError({
          message: "Memories are turned off for this thread, so nothing was saved.",
        });
      }
      if (input.learned !== true) {
        return yield* insert({ ...input, source: "agent" });
      }
      const learning = yield* readLearning;
      if (learning === "off") {
        return yield* new MemoryError({
          message:
            "Learning from corrections is turned off in Moonfold, so nothing was saved. Do not try again in this thread.",
        });
      }
      return yield* insert({
        ...input,
        source: "agent",
        status: learning === "suggest" ? "suggested" : "active",
      });
    },
    Effect.catchTags({
      SqlError: (cause) =>
        Effect.fail(new MemoryError({ message: "Could not save the memory.", cause })),
    }),
  );

  const forTurn: MemoryStore["Service"]["forTurn"] = Effect.fn("MemoryStore.forTurn")(
    function* (input) {
      if (!(yield* readEnabled) || (yield* isOptedOut(input.threadId))) return undefined;
      // Memories for every project first, then this project's, oldest first: a stable order
      // lets providers that resend context only on change skip unchanged turns.
      const rows = yield* sql<MemoryRow>`
        SELECT * FROM memories
        WHERE status = 'active' AND (project_id IS NULL OR project_id = ${input.projectId})
        ORDER BY project_id IS NOT NULL, created_at ASC
      `;
      if (rows.length === 0) return undefined;
      return {
        user: withinBudget(rows.filter((row) => row.source !== "agent").map((row) => row.text)),
        agent: withinBudget(rows.filter((row) => row.source === "agent").map((row) => row.text)),
      };
    },
    Effect.mapError(memoryError("Could not read memories.")),
  );

  return MemoryStore.of({
    list,
    upsert,
    remove,
    setEnabled,
    setLearning,
    threadStatus,
    setThreadOptOut,
    remember,
    forTurn,
  });
});

export const layer = Layer.effect(MemoryStore, make);

/**
 * What each turn of a thread receives. A reference with a no-memories default, so orchestration
 * hosts without a memory store (tests, replay harnesses) need not provide one.
 */
export class ThreadMemories extends Context.Reference<{
  readonly forTurn: (input: {
    readonly threadId: ThreadId;
    readonly projectId: ProjectId;
  }) => Effect.Effect<TurnMemories | undefined>;
}>("moonfold/memories/ThreadMemories", {
  defaultValue: () => ({ forTurn: () => Effect.undefined }),
}) {}

/** Turns read the store; a failed read costs the turn its memories, not the turn itself. */
export const layerThreadMemories = Layer.effect(
  ThreadMemories,
  Effect.gen(function* () {
    const store = yield* MemoryStore;
    return {
      forTurn: Effect.fn("ThreadMemories.forTurn")(
        (input: { readonly threadId: ThreadId; readonly projectId: ProjectId }) =>
          store.forTurn(input),
        Effect.catch((error) =>
          Effect.logWarning("Could not read memories for a turn", { error }).pipe(
            Effect.as(undefined),
          ),
        ),
      ),
    };
  }),
);
