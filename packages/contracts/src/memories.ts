/**
 * Memories: short notes agents receive at the start of every turn, for all projects or one.
 * The user writes and edits them; an agent can save one when the user asks it to remember
 * something. Memories stay on the environment's machine.
 */
import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Longest single memory, in characters. */
export const MAX_MEMORY_LENGTH = 1000;

export const MemoryId = TrimmedNonEmptyString.pipe(Schema.brand("MemoryId"));
export type MemoryId = typeof MemoryId.Type;

export const MemoryText = TrimmedNonEmptyString.check(Schema.isMaxLength(MAX_MEMORY_LENGTH));

/** A preference about how to work, or a fact about running the project (D-68). */
export const MemoryKind = Schema.Literals(["preference", "environment"]);
export type MemoryKind = typeof MemoryKind.Type;

/** What happens when an agent learns something from a correction without being asked. */
export const MemoryLearning = Schema.Literals(["off", "suggest", "auto"]);
export type MemoryLearning = typeof MemoryLearning.Type;

export const Memory = Schema.Struct({
  id: MemoryId,
  text: MemoryText,
  kind: MemoryKind,
  /** A suggestion waits for the user and reaches no turn until it is accepted. */
  status: Schema.Literals(["active", "suggested"]),
  /** The project it applies to, or null for every project. */
  projectId: Schema.NullOr(ProjectId),
  /** Who wrote it: the user, or an agent asked to remember something. */
  source: Schema.Literals(["user", "agent"]),
  /** The thread an agent saved it from. */
  threadId: Schema.NullOr(ThreadId),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type Memory = typeof Memory.Type;

export const MemoryListResult = Schema.Struct({
  /** Whether agents receive memories, and whether they can save new ones. */
  enabled: Schema.Boolean,
  learning: MemoryLearning,
  memories: Schema.Array(Memory),
});
export type MemoryListResult = typeof MemoryListResult.Type;

export const MemoryUpsertInput = Schema.Struct({
  /** Absent to add a memory. */
  id: Schema.optional(MemoryId),
  text: MemoryText,
  projectId: Schema.NullOr(ProjectId),
  /** Absent keeps an edited memory's kind, and adds a preference. */
  kind: Schema.optional(MemoryKind),
});
export type MemoryUpsertInput = typeof MemoryUpsertInput.Type;

export const MemoryIdInput = Schema.Struct({ id: MemoryId });
export type MemoryIdInput = typeof MemoryIdInput.Type;

export const MemorySetEnabledInput = Schema.Struct({
  enabled: Schema.Boolean,
  learning: Schema.optional(MemoryLearning),
});
export type MemorySetEnabledInput = typeof MemorySetEnabledInput.Type;

export const MemoryThreadInput = Schema.Struct({ threadId: ThreadId });
export type MemoryThreadInput = typeof MemoryThreadInput.Type;

export const MemoryThreadStatus = Schema.Struct({
  threadId: ThreadId,
  /** The user turned memories off for this thread. */
  optedOut: Schema.Boolean,
});
export type MemoryThreadStatus = typeof MemoryThreadStatus.Type;

export const MemorySetThreadOptOutInput = Schema.Struct({
  threadId: ThreadId,
  optedOut: Schema.Boolean,
});
export type MemorySetThreadOptOutInput = typeof MemorySetThreadOptOutInput.Type;

export const MemoryMutationResult = Schema.Struct({ memory: Memory });
export type MemoryMutationResult = typeof MemoryMutationResult.Type;

export class MemoryError extends Schema.TaggedError<MemoryError>()("MemoryError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}
