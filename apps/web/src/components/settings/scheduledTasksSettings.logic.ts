import { isWebhookDedupeTemplate } from "@moonfold/contracts";
import {
  EnvironmentId,
  MAX_WEBHOOK_DELIVERY_AGE_MINUTES,
  ProjectId,
  ScheduledTaskId,
  ThreadId,
  type ScheduledTask,
  type ScheduledTaskNotifyPolicy,
  type ScheduledTaskThreadMode,
  type ScheduledTaskUpsertSchedule,
  scheduledTaskThreadMode,
  type ModelSelection,
  type RuntimeMode,
  type ProviderInteractionMode,
  type ServerSettings,
} from "@moonfold/contracts";
import {
  parseMaxDeliveryAge,
  parseWebhookFilterDrafts,
  webhookFilterDrafts,
  webhookFilterDraftsChanged,
  type WebhookFilterDraft,
} from "@moonfold/client-runtime/scheduled-task-webhook";
import { cronError, isValidTimeZone } from "@moonfold/shared/cron";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import {
  resolveProjectSettings,
  type LegacyProjectSettingsFields,
} from "@moonfold/shared/projectSettings";
import type { ProviderInstanceEntry } from "../../providerInstances";

import type { ResolvedSettingsScope } from "./settingsScope";

export function matchesScheduledTaskScope(
  scope: ResolvedSettingsScope,
  environmentId: EnvironmentId,
  projectId: ProjectId,
): boolean {
  if (scope.kind === "unavailable" || !scope.environmentIds.includes(environmentId)) return false;
  if (scope.kind === "project" || scope.kind === "checkout") {
    return scope.members.some(
      (member) => member.environmentId === environmentId && member.id === projectId,
    );
  }
  return true;
}

export function validateScheduledTasksSearch(raw: Record<string, unknown>) {
  return {
    ...(typeof raw.environmentId === "string" && raw.environmentId.trim()
      ? { environmentId: EnvironmentId.make(raw.environmentId) }
      : {}),
    ...(typeof raw.taskId === "string" && raw.taskId.trim()
      ? { taskId: ScheduledTaskId.make(raw.taskId) }
      : {}),
    // Opens a new task that continues this thread on each run.
    ...(typeof raw.threadId === "string" && raw.threadId.trim()
      ? { threadId: ThreadId.make(raw.threadId) }
      : {}),
    ...(typeof raw.projectId === "string" && raw.projectId.trim()
      ? { projectId: ProjectId.make(raw.projectId) }
      : {}),
  };
}

export type ScheduleMode = "fixed" | "once" | "cron" | "interval" | "webhook";
export type WorkspaceMode = "root" | "worktree" | "existing_worktree";

export interface DraftState {
  readonly editingId: string | null;
  readonly title: string;
  readonly prompt: string;
  readonly enabled: boolean;
  readonly scheduleMode: ScheduleMode;
  readonly intervalMinutes: string;
  readonly timeOfDay: string;
  /** Local date and time as a `datetime-local` input value, such as 2026-11-02T15:00. */
  readonly runAt: string;
  /** The stored ISO run time, sent back unchanged when the field was not edited. */
  readonly savedRunAt: string;
  readonly weekdays: ReadonlySet<number>;
  readonly cronExpression: string;
  /** Optional last day ("YYYY-MM-DD") a cron task may run, in `timeZone`. */
  readonly cronUntil: string;
  /** IANA zone a cron schedule is read in. */
  readonly timeZone: string;
  /** When runs notify: every run, failures only, or never. */
  readonly notify: ScheduledTaskNotifyPolicy;
  readonly projectId: string;
  readonly threadId: string;
  readonly threadMode: ScheduledTaskThreadMode;
  readonly workspaceMode: WorkspaceMode;
  readonly baseRef: string;
  readonly startFromOrigin: boolean;
  readonly existingWorktreePath: string;
  readonly modelKey: string;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  /** Retain the source selection's provider options when the picker leaves instanceId:model unchanged. */
  readonly baseModelSelection: ModelSelection | null;
  readonly signatureEnabled: boolean;
  readonly signatureHeader: string;
  readonly signatureEncoding: "hex" | "base64";
  readonly signaturePrefix: string;
  /** Write-only: empty keeps the secret already stored on the server. */
  readonly signatureSecret: string;
  readonly maxDeliveryAgeMinutes: string;
  readonly replayKey: string;
  readonly coalesceKey: string;
  readonly coalesceWindowSeconds: string;
  readonly filters: ReadonlyArray<WebhookFilterDraft>;
  /** The filter rows the form opened with. */
  readonly savedFilters: ReadonlyArray<WebhookFilterDraft>;
}

export const WEBHOOK_SIGNATURE_DEFAULTS = {
  signatureHeader: "x-hub-signature-256",
  signatureEncoding: "hex",
  signaturePrefix: "sha256=",
} as const;

/** Formats a date as a `datetime-local` input value in the browser's time zone. */
export function toDateTimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function scheduleDraftErrors(draft: DraftState) {
  if (draft.scheduleMode === "once") {
    const runAt = new Date(draft.runAt);
    if (Number.isNaN(runAt.getTime()))
      return [{ title: "Invalid run time", description: "Pick a date and time." }];
    // A time skipped by a daylight saving change parses to a different clock time.
    if (toDateTimeLocalValue(runAt) !== draft.runAt)
      return [
        { title: "Invalid run time", description: "That time does not exist in your time zone." },
      ];
    return [];
  }
  if (draft.scheduleMode === "cron") {
    const problem = calendarScheduleProblem(draft);
    return problem === null ? [] : [{ title: "Schedule is not valid", description: problem }];
  }
  if (draft.scheduleMode !== "webhook") return [];
  if (parseMaxDeliveryAge(draft.maxDeliveryAgeMinutes) === undefined)
    return [
      {
        title: "Invalid age limit",
        description: `Enter whole minutes from 1 to ${MAX_WEBHOOK_DELIVERY_AGE_MINUTES}, or leave it blank.`,
      },
    ];
  const errors: Array<{ title: string; description: string }> = [];
  for (const [label, value] of [
    ["Duplicate request key", draft.replayKey],
    ["Coalesce key", draft.coalesceKey],
  ] as const) {
    if (value.trim() && !isWebhookDedupeTemplate(value.trim()))
      errors.push({
        title: "Invalid webhook settings",
        description: `${label} must contain a valid request placeholder.`,
      });
  }
  const window = draft.coalesceWindowSeconds.trim();
  if (window && (!Number.isInteger(Number(window)) || Number(window) < 10 || Number(window) > 3600))
    errors.push({
      title: "Invalid webhook settings",
      description: "Coalesce window must be whole seconds from 10 to 3600.",
    });
  return errors;
}

export function webhookDeliveryLabel(delivery: {
  readonly outcome: string;
  readonly pendingWindow?: boolean | undefined;
}) {
  if (delivery.outcome === "accepted") return delivery.pendingWindow ? "Opened window" : "Ran";
  const labels: Record<string, string> = {
    dispatch_failed: "Run failed",
    duplicate: "Duplicate",
    coalesced: "Coalesced",
    filtered: "Filtered",
    rejected_signature: "Bad signature",
    disabled: "Task paused",
    rate_limited: "Rate limited",
    expired: "Too old",
  };
  return labels[delivery.outcome] ?? delivery.outcome.replaceAll("_", " ");
}

export function scheduleFromDraft(draft: DraftState): ScheduledTaskUpsertSchedule | null {
  if (scheduleDraftErrors(draft).length > 0) return null;
  if (draft.scheduleMode === "once") {
    const saved = draft.savedRunAt ? new Date(draft.savedRunAt) : null;
    if (saved !== null && toDateTimeLocalValue(saved) === draft.runAt)
      return { type: "once", runAt: draft.savedRunAt };
    // A `datetime-local` value has no offset. In an hour that repeats when clocks go
    // back, keep the saved time's offset; otherwise Date reads it as local time.
    const withSavedOffset =
      saved === null
        ? null
        : new Date(Date.parse(`${draft.runAt}Z`) + saved.getTimezoneOffset() * 60_000);
    return {
      type: "once",
      runAt:
        withSavedOffset !== null && toDateTimeLocalValue(withSavedOffset) === draft.runAt
          ? withSavedOffset.toISOString()
          : new Date(draft.runAt).toISOString(),
    };
  }
  if (draft.scheduleMode === "webhook") {
    const maxDeliveryAgeMinutes = parseMaxDeliveryAge(draft.maxDeliveryAgeMinutes);
    const replayKey = draft.replayKey.trim();
    const coalesceKey = draft.coalesceKey.trim();
    const coalesceWindowSeconds = draft.coalesceWindowSeconds.trim()
      ? Number(draft.coalesceWindowSeconds)
      : undefined;
    if (maxDeliveryAgeMinutes === undefined) return null;
    const parsedFilters = parseWebhookFilterDrafts(draft.filters);
    if (!("filters" in parsedFilters)) return null;
    const secret = draft.signatureSecret.trim();
    return {
      type: "webhook",
      signature: draft.signatureEnabled
        ? {
            header: draft.signatureHeader.trim(),
            encoding: draft.signatureEncoding,
            prefix: draft.signaturePrefix,
            ...(secret ? { secret } : {}),
          }
        : null,
      maxDeliveryAgeMinutes,
      ...(replayKey || coalesceKey || coalesceWindowSeconds !== undefined
        ? {
            dedupe: {
              ...(replayKey ? { replayKey } : {}),
              ...(coalesceKey ? { coalesceKey } : {}),
              ...(coalesceWindowSeconds === undefined ? {} : { coalesceWindowSeconds }),
            },
          }
        : { dedupe: {} }),
      // Only edited filters are sent; the server keeps the stored ones otherwise.
      ...(webhookFilterDraftsChanged(draft.savedFilters, draft.filters)
        ? { filters: parsedFilters.filters }
        : {}),
    };
  }
  if (draft.scheduleMode === "cron") {
    const timeZone = draft.timeZone.trim();
    return {
      type: "cron",
      expression: draft.cronExpression.trim().split(/\s+/).join(" "),
      timeZone,
      until: draft.cronUntil ? endOfLocalDay(draft.cronUntil, timeZone) : null,
    };
  }
  if (draft.scheduleMode === "interval") {
    const everyMs = Math.round(Number(draft.intervalMinutes) * 60_000);
    return { type: "interval", everyMs };
  }
  const selectedEveryDay = draft.weekdays.size === 0 || draft.weekdays.size === 7;
  return {
    type: "fixed_time",
    timeOfDay: draft.timeOfDay || "09:00",
    ...(selectedEveryDay ? {} : { weekdays: [...draft.weekdays].toSorted() }),
  };
}

export function taskToDraft(task: ScheduledTask): DraftState {
  const schedule = task.schedule;
  const filters = webhookFilterDrafts(schedule.type === "webhook" ? schedule.filters : undefined);
  const weekdays =
    schedule.type === "fixed_time" && schedule.weekdays && schedule.weekdays.length > 0
      ? new Set(schedule.weekdays)
      : new Set([0, 1, 2, 3, 4, 5, 6]);
  return {
    editingId: task.id,
    title: task.title,
    prompt: task.prompt,
    enabled: task.enabled,
    scheduleMode: schedule.type === "fixed_time" ? "fixed" : schedule.type,
    intervalMinutes:
      schedule.type === "interval" ? String(Math.max(1, schedule.everyMs / 60_000)) : "15",
    timeOfDay: schedule.type === "fixed_time" ? schedule.timeOfDay : "09:00",
    runAt: schedule.type === "once" ? toDateTimeLocalValue(new Date(schedule.runAt)) : "",
    savedRunAt: schedule.type === "once" ? schedule.runAt : "",
    weekdays,
    cronExpression: schedule.type === "cron" ? schedule.expression : "0 9 * * 1-5",
    cronUntil:
      schedule.type === "cron" && schedule.until != null
        ? localDate(schedule.until, schedule.timeZone)
        : "",
    timeZone: schedule.type === "cron" ? schedule.timeZone : browserTimeZone(),
    notify: task.notify ?? "all",
    projectId: task.projectId,
    threadId: task.threadId ?? "",
    threadMode: scheduledTaskThreadMode(task),
    workspaceMode: task.workspaceStrategy.type,
    baseRef: task.workspaceStrategy.type === "worktree" ? task.workspaceStrategy.baseRef : "main",
    startFromOrigin:
      task.workspaceStrategy.type === "worktree"
        ? (task.workspaceStrategy.startFromOrigin ?? false)
        : true,
    existingWorktreePath:
      task.workspaceStrategy.type === "existing_worktree"
        ? task.workspaceStrategy.worktreePath
        : "",
    modelKey: `${task.modelSelection.instanceId}:${task.modelSelection.model}`,
    runtimeMode: task.runtimeMode,
    interactionMode: task.interactionMode,
    baseModelSelection: task.modelSelection,
    ...(schedule.type === "webhook" && schedule.signature !== null
      ? {
          signatureEnabled: true,
          signatureHeader: schedule.signature.header,
          signatureEncoding: schedule.signature.encoding,
          signaturePrefix: schedule.signature.prefix,
        }
      : { signatureEnabled: false, ...WEBHOOK_SIGNATURE_DEFAULTS }),
    signatureSecret: "",
    replayKey: schedule.type === "webhook" ? (schedule.dedupe?.replayKey ?? "") : "",
    coalesceKey: schedule.type === "webhook" ? (schedule.dedupe?.coalesceKey ?? "") : "",
    coalesceWindowSeconds:
      schedule.type === "webhook" && schedule.dedupe?.coalesceWindowSeconds !== undefined
        ? String(schedule.dedupe.coalesceWindowSeconds)
        : "",
    maxDeliveryAgeMinutes:
      schedule.type === "webhook" && schedule.maxDeliveryAgeMinutes != null
        ? String(schedule.maxDeliveryAgeMinutes)
        : "",
    filters,
    savedFilters: filters,
  };
}

/** The viewer's own time zone, the default for new cron tasks. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** The last instant of a local date in a time zone, as an ISO string. */
function endOfLocalDay(date: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const zone = DateTime.zoneMakeNamed(timeZone);
  if (match === null || Option.isNone(zone)) return null;
  const end = DateTime.setParts(DateTime.setZone(DateTime.makeUnsafe(0), zone.value), {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: 23,
    minute: 59,
    second: 59,
    millisecond: 0,
  });
  return DateTime.formatIso(end);
}

/** The local "YYYY-MM-DD" date of an instant in a time zone. */
function localDate(iso: string, timeZone: string): string {
  const zone = DateTime.zoneMakeNamed(timeZone);
  const instant = DateTime.makeUnsafe(iso);
  const parts = DateTime.toParts(
    Option.isSome(zone) ? DateTime.setZone(instant, zone.value) : instant,
  );
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Why a cron draft cannot be saved, or null when it can (or the draft is not cron). */
export function calendarScheduleProblem(draft: DraftState): string | null {
  if (draft.scheduleMode !== "cron") return null;
  const timeZone = draft.timeZone.trim();
  if (!isValidTimeZone(timeZone)) return `Unknown time zone "${timeZone}".`;
  const expressionProblem = cronError(draft.cronExpression);
  if (expressionProblem !== null) return expressionProblem;
  if (draft.cronUntil && endOfLocalDay(draft.cronUntil, timeZone) === null) {
    return "Pick a valid last day, or leave it blank.";
  }
  return null;
}

/**
 * Starts a task that keeps a thread's pull request healthy: bound to the PR's thread, it checks
 * each hour and fixes failing checks or open review comments in that thread's worktree.
 */
export function applyPullRequestFixTemplate(draft: DraftState): DraftState {
  return {
    ...draft,
    title: draft.title.trim() ? draft.title : "Keep the pull request green",
    prompt: [
      "Check the pull request for this thread.",
      "If checks are failing or review comments are unresolved, fix them in this thread's worktree, commit, and push.",
      "If everything passes and nothing is open, reply that the pull request is green and change nothing.",
      "Never touch the project's main checkout and never create scheduled tasks.",
    ].join(" "),
    scheduleMode: "cron",
    cronExpression: "0 * * * *",
    notify: "failures",
  };
}

/** Appends a `$skill` mention, the form providers read as a request to use that skill. */
export function appendSkillMention(prompt: string, skillName: string): string {
  const mention = `$${skillName}`;
  if (prompt.includes(mention)) return prompt;
  const trimmed = prompt.replace(/\s+$/, "");
  return trimmed ? `${trimmed} ${mention} ` : `${mention} `;
}

/** Ready-made cron schedules the form offers before the custom expression. */
export const CRON_PRESETS: ReadonlyArray<{ readonly label: string; readonly expression: string }> =
  [
    { label: "Every hour", expression: "0 * * * *" },
    { label: "Every day at 09:00", expression: "0 9 * * *" },
    { label: "Weekdays at 09:00", expression: "0 9 * * 1-5" },
    { label: "Mondays at 09:00", expression: "0 9 * * 1" },
    { label: "First of the month at 09:00", expression: "0 9 1 * *" },
  ];

export function scheduledTaskDefaultModel(
  settings: ServerSettings,
  project: (LegacyProjectSettingsFields & { readonly id: ProjectId }) | null,
  entries: readonly ProviderInstanceEntry[],
): ModelSelection | null {
  const available = entries.filter(
    (entry) =>
      entry.enabled &&
      entry.installed &&
      entry.isAvailable &&
      entry.snapshot.auth.status !== "unauthenticated",
  );
  const configured = resolveProjectSettings(settings, project?.id ?? null, project).settings
    .defaultModelSelection;
  for (const selection of [configured, settings.defaultModelSelection]) {
    if (
      selection &&
      available.some(
        (entry) =>
          entry.instanceId === selection.instanceId &&
          entry.models.find((model) => model.slug === selection.model)?.isLegacy !== true,
      )
    )
      return selection;
  }
  const models = available.flatMap((entry) =>
    entry.models
      .filter((model) => !model.isLegacy)
      .map((model) => ({ instanceId: entry.instanceId, model })),
  );
  const fallback = models.find(({ model }) => model.isDefault) ?? models[0];
  return fallback ? { instanceId: fallback.instanceId, model: fallback.model.slug } : null;
}

/**
 * A new task's project: a pinned open project, then any open one. An archived
 * project only when Settings is scoped to it, so that scope can still save.
 */
export function defaultScheduledTaskProjectId<
  TProject extends {
    readonly id: ProjectId;
    readonly pinnedAt?: string | null | undefined;
    readonly archivedAt?: string | null | undefined;
  },
>(scopedProjects: ReadonlyArray<TProject>, scope: ResolvedSettingsScope): ProjectId | "" {
  const open = scopedProjects.filter((project) => project.archivedAt == null);
  const scopedToProject = scope.kind === "project" || scope.kind === "checkout";
  return (
    (
      open.find((project) => project.pinnedAt != null) ??
      open[0] ??
      (scopedToProject ? scopedProjects[0] : undefined)
    )?.id ?? ""
  );
}
