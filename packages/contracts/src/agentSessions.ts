import * as Schema from "effect/Schema";
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const AgentSessionSource = Schema.Literals(["claudeAgent", "codex", "antigravity", "pi"]);
export type AgentSessionSource = typeof AgentSessionSource.Type;

export const AgentSessionImportSource = Schema.Struct({
  provider: AgentSessionSource,
  providerInstanceId: ProviderInstanceId,
  providerSessionId: TrimmedNonEmptyString,
  filePath: TrimmedNonEmptyString,
  size: NonNegativeInt,
  mtimeMs: Schema.NullOr(Schema.Number),
  device: Schema.Number,
  // A decimal string keeps file IDs above 2^53 (common on NTFS) exact. Older
  // records stored a number.
  inode: Schema.NullOr(Schema.Union([Schema.String, Schema.Number])),
  birthtimeMs: Schema.NullOr(Schema.Number),
});
export type AgentSessionImportSource = typeof AgentSessionImportSource.Type;

export const AgentSessionScanInput = Schema.Struct({});
export type AgentSessionScanInput = typeof AgentSessionScanInput.Type;

export const AgentSessionProjectGit = Schema.Struct({
  remoteKey: Schema.NullOr(Schema.String),
  repository: Schema.NullOr(Schema.String),
});
export type AgentSessionProjectGit = typeof AgentSessionProjectGit.Type;

export const AgentSessionProjectCandidate = Schema.Struct({
  path: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  projectId: Schema.optional(ProjectId),
  sources: Schema.Array(AgentSessionSource),
  threadCount: NonNegativeInt,
  lastActiveAt: Schema.NullOr(IsoDateTime),
  alreadyImported: Schema.Boolean,
  git: Schema.optionalKey(Schema.NullOr(AgentSessionProjectGit)),
});
export type AgentSessionProjectCandidate = typeof AgentSessionProjectCandidate.Type;

export const AgentSessionScanResult = Schema.Struct({
  candidates: Schema.Array(AgentSessionProjectCandidate),
  scannedAt: IsoDateTime,
  truncated: Schema.optional(Schema.Boolean),
});
export type AgentSessionScanResult = typeof AgentSessionScanResult.Type;

export const AgentSessionImportInput = Schema.Struct({
  projectId: ProjectId,
  expectedWorkspaceRoot: Schema.optional(TrimmedNonEmptyString),
});
export type AgentSessionImportInput = typeof AgentSessionImportInput.Type;

export const AgentSessionSummary = Schema.Struct({
  provider: AgentSessionSource,
  providerInstanceId: ProviderInstanceId,
  sessionId: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  cwd: Schema.NullOr(TrimmedNonEmptyString),
  model: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  alreadyImportedThreadId: Schema.NullOr(ThreadId),
  matchedProjectId: Schema.NullOr(ProjectId),
});
export type AgentSessionSummary = typeof AgentSessionSummary.Type;

export const AgentSessionListInput = Schema.Struct({
  provider: Schema.optional(AgentSessionSource),
  projectId: Schema.optional(ProjectId),
  query: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }))),
});
export type AgentSessionListInput = typeof AgentSessionListInput.Type;

export const AgentSessionListResult = Schema.Struct({
  sessions: Schema.Array(AgentSessionSummary),
  truncated: Schema.optional(Schema.Boolean),
});
export type AgentSessionListResult = typeof AgentSessionListResult.Type;

export const AgentSessionLookupInput = Schema.Struct({
  sessionId: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  provider: Schema.optional(AgentSessionSource),
});
export type AgentSessionLookupInput = typeof AgentSessionLookupInput.Type;

export const AgentSessionLookupPreview = Schema.Struct({
  ...AgentSessionSummary.fields,
  messageCount: NonNegativeInt,
  toolCallCount: NonNegativeInt,
  reasoningCount: NonNegativeInt,
  omittedItemCount: NonNegativeInt,
  firstUserPrompt: Schema.NullOr(Schema.String),
});
export type AgentSessionLookupPreview = typeof AgentSessionLookupPreview.Type;

export const AgentSessionLookupResult = Schema.Struct({
  session: Schema.NullOr(AgentSessionLookupPreview),
});
export type AgentSessionLookupResult = typeof AgentSessionLookupResult.Type;

export const AgentSessionImportSessionInput = Schema.Struct({
  sessionId: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  provider: Schema.optional(AgentSessionSource),
  providerInstanceId: Schema.optional(ProviderInstanceId),
  projectId: ProjectId,
});
export type AgentSessionImportSessionInput = typeof AgentSessionImportSessionInput.Type;

export const AgentSessionImportSessionResult = Schema.Struct({
  threadId: ThreadId,
  imported: Schema.Boolean,
  alreadyImported: Schema.Boolean,
  provider: AgentSessionSource,
  title: TrimmedNonEmptyString,
  messageCount: NonNegativeInt,
  toolCallCount: NonNegativeInt,
  reasoningCount: NonNegativeInt,
  omittedItemCount: NonNegativeInt,
});
export type AgentSessionImportSessionResult = typeof AgentSessionImportSessionResult.Type;

export class AgentSessionImportNotFoundError extends Schema.TaggedError<AgentSessionImportNotFoundError>()(
  "AgentSessionImportNotFoundError",
  {
    sessionId: Schema.String,
    provider: Schema.optional(AgentSessionSource),
  },
) {
  override get message(): string {
    return this.provider === undefined
      ? `No external chat session was found with ID '${this.sessionId}'.`
      : `No '${this.provider}' chat session was found with ID '${this.sessionId}'.`;
  }
}

export class AgentSessionImportProjectNotFoundError extends Schema.TaggedError<AgentSessionImportProjectNotFoundError>()(
  "AgentSessionImportProjectNotFoundError",
  { projectId: ProjectId },
) {
  override get message(): string {
    return `Project '${this.projectId}' does not exist.`;
  }
}

export class AgentSessionImportProjectChangedError extends Schema.TaggedError<AgentSessionImportProjectChangedError>()(
  "AgentSessionImportProjectChangedError",
  { projectId: ProjectId },
) {
  override get message(): string {
    return `Project '${this.projectId}' changed directories. Scan for projects again before importing history.`;
  }
}

export const AgentSessionImportResult = Schema.Struct({
  importedCount: NonNegativeInt,
  skippedCount: NonNegativeInt,
});
export type AgentSessionImportResult = typeof AgentSessionImportResult.Type;

export class AgentSessionScanError extends Schema.TaggedError<AgentSessionScanError>()(
  "AgentSessionScanError",
  {
    operation: Schema.Literals(["read-settings", "read-projects"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to scan agent sessions during ${this.operation}.`;
  }
}
