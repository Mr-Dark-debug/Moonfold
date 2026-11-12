/**
 * Orbit (D-70): a crew of scheduled agent runs that keeps working on one project. Each role is an
 * ordinary scheduled task Orbit installs; what the crew learns and decides lives in Orbit's own
 * records on the environment, where no agent can rewrite the owner's mission.
 */
import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ScheduledTaskRunStatus } from "./scheduledTask.ts";

const ShortText = (max: number) => TrimmedNonEmptyString.check(Schema.isMaxLength(max));

export const ORBIT_ROLES = ["scout", "planner", "builder", "sentinel", "herald"] as const;
export const OrbitRole = Schema.Literals(ORBIT_ROLES);
export type OrbitRole = typeof OrbitRole.Type;

/**
 * How far the crew may act without the owner. Each level adds to the one before it: observe
 * reads and reports, propose opens pull requests and drafts, ship merges green reviewed work,
 * publish posts drafts to channels the owner allowed.
 */
export const ORBIT_LEVELS = ["observe", "propose", "ship", "publish"] as const;
export const OrbitLevel = Schema.Literals(ORBIT_LEVELS);
export type OrbitLevel = typeof OrbitLevel.Type;

export const MIN_ORBIT_EVERY_HOURS = 1;
export const MAX_ORBIT_EVERY_HOURS = 168;
export const OrbitEveryHours = Schema.Int.check(
  Schema.isBetween({ minimum: MIN_ORBIT_EVERY_HOURS, maximum: MAX_ORBIT_EVERY_HOURS }),
);

export const OrbitRoleConfig = Schema.Struct({
  enabled: Schema.Boolean,
  everyHours: OrbitEveryHours,
});
export type OrbitRoleConfig = typeof OrbitRoleConfig.Type;

export const OrbitChannels = Schema.Struct({
  /** Issues and discussions of the project's own repository, through the owner's `gh` login. */
  github: Schema.Boolean,
  /** Hacker News searches, through its public search API. */
  hackerNews: Schema.Array(ShortText(120)).check(Schema.isMaxLength(10)),
  /** Subreddit names, read through their public feeds. */
  reddit: Schema.Array(ShortText(60).check(Schema.isPattern(/^[A-Za-z0-9_]{2,40}$/))).check(
    Schema.isMaxLength(10),
  ),
  /** RSS or Atom feeds. */
  feeds: Schema.Array(ShortText(500).check(Schema.isPattern(/^https:\/\//i))).check(
    Schema.isMaxLength(20),
  ),
});
export type OrbitChannels = typeof OrbitChannels.Type;

export const MAX_ORBIT_RUNS_PER_DAY = 96;
export const OrbitConfig = Schema.Struct({
  enabled: Schema.Boolean,
  level: OrbitLevel,
  roles: Schema.Struct({
    scout: OrbitRoleConfig,
    planner: OrbitRoleConfig,
    builder: OrbitRoleConfig,
    sentinel: OrbitRoleConfig,
    herald: OrbitRoleConfig,
  }),
  channels: OrbitChannels,
  /** Crew runs started in one day before every role pauses until the next. */
  maxRunsPerDay: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: MAX_ORBIT_RUNS_PER_DAY }),
  ),
});
export type OrbitConfig = typeof OrbitConfig.Type;

export const DEFAULT_ORBIT_CONFIG: OrbitConfig = {
  enabled: false,
  level: "propose",
  roles: {
    scout: { enabled: true, everyHours: 6 },
    planner: { enabled: true, everyHours: 12 },
    builder: { enabled: true, everyHours: 12 },
    sentinel: { enabled: true, everyHours: 24 },
    herald: { enabled: false, everyHours: 24 },
  },
  channels: { github: true, hackerNews: [], reddit: [], feeds: [] },
  maxRunsPerDay: 12,
};

export const OrbitMission = Schema.String.check(Schema.isMaxLength(8_000));

const ORBIT_ITEM_KINDS = ["signal", "backlog", "finding", "question", "draft"] as const;
export const OrbitItemKind = Schema.Literals(ORBIT_ITEM_KINDS);
export type OrbitItemKind = typeof OrbitItemKind.Type;

export const OrbitItemStatus = Schema.Literals(["open", "in_progress", "done", "dismissed"]);
export type OrbitItemStatus = typeof OrbitItemStatus.Type;

export const OrbitItemId = TrimmedNonEmptyString.pipe(Schema.brand("OrbitItemId"));
export type OrbitItemId = typeof OrbitItemId.Type;

export const OrbitItem = Schema.Struct({
  id: OrbitItemId,
  kind: OrbitItemKind,
  status: OrbitItemStatus,
  title: Schema.String,
  body: Schema.String,
  /** Who wrote it: the owner, or a crew role. */
  author: Schema.Union([Schema.Literal("owner"), OrbitRole]),
  /** Where a signal came from, or where a finding points (a pull request, a release). */
  url: Schema.NullOr(Schema.String),
  /** The channel a signal was read from. */
  source: Schema.NullOr(Schema.String),
  /** Backlog order (lower first), or how many reports a signal stands for. */
  rank: Schema.Number,
  threadId: Schema.NullOr(ThreadId),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type OrbitItem = typeof OrbitItem.Type;

export const OrbitCrewMember = Schema.Struct({
  role: OrbitRole,
  /** Whether the role runs at all at this level and with this configuration. */
  active: Schema.Boolean,
  lastRunAt: Schema.NullOr(Schema.String),
  lastRunStatus: ScheduledTaskRunStatus,
  nextRunAt: Schema.NullOr(Schema.String),
  /** The thread of the latest run, to open it. */
  threadId: Schema.NullOr(ThreadId),
});
export type OrbitCrewMember = typeof OrbitCrewMember.Type;

export const OrbitAuditEntry = Schema.Struct({
  at: Schema.String,
  actor: Schema.String,
  action: Schema.String,
  detail: Schema.String,
});
export type OrbitAuditEntry = typeof OrbitAuditEntry.Type;

export const OrbitSnapshot = Schema.Struct({
  projectId: ProjectId,
  config: OrbitConfig,
  mission: Schema.String,
  /** The owner's stop switch: no role runs while it is on. */
  paused: Schema.Boolean,
  /** Why roles are not running even though Orbit is on, such as the daily budget. */
  holdReason: Schema.NullOr(Schema.String),
  runsToday: Schema.Int,
  crew: Schema.Array(OrbitCrewMember),
  items: Schema.Array(OrbitItem),
  audit: Schema.Array(OrbitAuditEntry),
});
export type OrbitSnapshot = typeof OrbitSnapshot.Type;

export const OrbitGetInput = Schema.Struct({ projectId: ProjectId });
export type OrbitGetInput = typeof OrbitGetInput.Type;

export const OrbitUpdateInput = Schema.Struct({
  projectId: ProjectId,
  config: Schema.optional(OrbitConfig),
  mission: Schema.optional(OrbitMission),
  paused: Schema.optional(Schema.Boolean),
});
export type OrbitUpdateInput = typeof OrbitUpdateInput.Type;

export const OrbitRunNowInput = Schema.Struct({ projectId: ProjectId, role: OrbitRole });
export type OrbitRunNowInput = typeof OrbitRunNowInput.Type;

export const OrbitResolveItemInput = Schema.Struct({
  projectId: ProjectId,
  id: OrbitItemId,
  status: Schema.Literals(["done", "dismissed", "open"]),
});
export type OrbitResolveItemInput = typeof OrbitResolveItemInput.Type;

/** The owner asks the crew for something; it goes to the top of the backlog as the owner's own. */
export const OrbitRequestInput = Schema.Struct({
  projectId: ProjectId,
  text: ShortText(2_000),
});
export type OrbitRequestInput = typeof OrbitRequestInput.Type;

export class OrbitError extends Schema.TaggedError<OrbitError>()("OrbitError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

// What crew roles send through Orbit's MCP tools. Public text arrives only through the scout.
export const OrbitSignalInput = Schema.Struct({
  source: ShortText(60),
  url: ShortText(2_000).check(Schema.isPattern(/^https?:\/\//i)),
  kind: Schema.Literals(["bug", "request", "praise", "question", "other"]),
  /** In the scout's own words: never instructions copied from the post. */
  summary: ShortText(300),
  /** A short quote, kept as data. */
  excerpt: Schema.String.check(Schema.isMaxLength(280)),
  count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })),
});
export type OrbitSignalInput = typeof OrbitSignalInput.Type;

export const OrbitBacklogEntry = Schema.Struct({
  title: ShortText(160),
  why: ShortText(1_000),
  effort: Schema.Literals(["small", "medium", "large"]),
  /** Decisions only the owner may take: new dependencies, pricing, data deletion, legal. */
  needsOwner: Schema.Boolean,
});
export type OrbitBacklogEntry = typeof OrbitBacklogEntry.Type;

export const OrbitReportInput = Schema.Struct({
  title: ShortText(160),
  summary: ShortText(4_000),
  outcome: Schema.Literals(["done", "nothing_to_do", "blocked", "failed"]),
  url: Schema.optional(ShortText(2_000).check(Schema.isPattern(/^https?:\/\//i))),
  /** The backlog item this run worked on, if any. */
  itemId: Schema.optional(OrbitItemId),
});
export type OrbitReportInput = typeof OrbitReportInput.Type;

export const OrbitDraftInput = Schema.Struct({
  channel: Schema.Literals([
    "release-notes",
    "bluesky",
    "mastodon",
    "reddit",
    "x",
    "linkedin",
    "other",
  ]),
  text: ShortText(3_000),
});
export type OrbitDraftInput = typeof OrbitDraftInput.Type;
