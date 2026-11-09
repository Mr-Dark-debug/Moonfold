import {
  MIN_SCHEDULED_TASK_INTERVAL_MS,
  type ScheduledTaskSchedule,
  type ScheduledTaskUpsertSchedule,
} from "@moonfold/contracts";
import { nextCronOccurrence, parseCron } from "@moonfold/shared/cron";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

const MINUTE_MS = 60_000;

function parseTimeOfDay(value: string): { hour: number; minute: number } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** Why a cron schedule cannot run, or null when it can. */
export function scheduleProblem(
  schedule: ScheduledTaskSchedule | ScheduledTaskUpsertSchedule,
): string | null {
  if (schedule.type !== "cron") return null;
  if (Option.isNone(DateTime.zoneMakeNamed(schedule.timeZone))) {
    return `Unknown time zone "${schedule.timeZone}".`;
  }
  try {
    parseCron(schedule.expression);
  } catch (error) {
    return error instanceof Error ? error.message : "The cron expression is not valid.";
  }
  return null;
}

export function nextScheduledRunAt(
  schedule: ScheduledTaskSchedule,
  from: DateTime.DateTime,
): DateTime.DateTime | null {
  if (schedule.type === "webhook") return null;
  if (schedule.type === "once") {
    const runAt = DateTime.make(schedule.runAt);
    return Option.isSome(runAt) &&
      DateTime.toEpochMillis(runAt.value) > DateTime.toEpochMillis(from)
      ? runAt.value
      : null;
  }
  if (schedule.type === "cron") {
    if (scheduleProblem(schedule) !== null) return null;
    const next = nextCronOccurrence(parseCron(schedule.expression), from, schedule.timeZone);
    if (next === null) return null;
    if (
      schedule.until != null &&
      DateTime.toEpochMillis(next) > DateTime.toEpochMillis(DateTime.makeUnsafe(schedule.until))
    ) {
      return null;
    }
    return next;
  }
  if (schedule.type === "interval") {
    // Intervals advance elapsed time, including across daylight-saving changes.
    return DateTime.addDuration(from, Math.max(schedule.everyMs, MIN_SCHEDULED_TASK_INTERVAL_MS));
  }

  const time = parseTimeOfDay(schedule.timeOfDay);
  if (time === null) return null;
  const weekdays =
    schedule.weekdays && schedule.weekdays.length > 0 ? new Set(schedule.weekdays) : null;
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = DateTime.setParts(DateTime.add(from, { days: offset }), {
      hour: time.hour,
      minute: time.minute,
      second: 0,
      millisecond: 0,
    });
    if (DateTime.toEpochMillis(candidate) <= DateTime.toEpochMillis(from)) continue;
    if (weekdays !== null && !weekdays.has(DateTime.toParts(candidate).weekDay)) continue;
    return candidate;
  }
  return null;
}

function weekdayKey(weekdays: ReadonlyArray<number> | undefined): string {
  const unique = [...new Set(weekdays ?? [])].toSorted((x, y) => x - y);
  if (unique.length === 0 || unique.length === 7) return "daily";
  return unique.join(",");
}

export function isSameSchedule(a: ScheduledTaskSchedule, b: ScheduledTaskSchedule): boolean {
  if (a.type === "interval") {
    return b.type === "interval" && a.everyMs === b.everyMs;
  }
  if (a.type === "webhook") return b.type === "webhook";
  if (a.type === "once") return b.type === "once" && Date.parse(a.runAt) === Date.parse(b.runAt);
  if (a.type === "cron") {
    return (
      b.type === "cron" &&
      a.expression.trim().split(/\s+/).join(" ") === b.expression.trim().split(/\s+/).join(" ") &&
      a.timeZone === b.timeZone &&
      (a.until ?? null) === (b.until ?? null)
    );
  }
  if (b.type !== "fixed_time") return false;
  // Compare parsed times so padded-hour edits do not reschedule pending runs.
  const aTime = parseTimeOfDay(a.timeOfDay);
  const bTime = parseTimeOfDay(b.timeOfDay);
  return (
    aTime !== null &&
    bTime !== null &&
    aTime.hour === bTime.hour &&
    aTime.minute === bTime.minute &&
    weekdayKey(a.weekdays) === weekdayKey(b.weekdays)
  );
}

const MISSED_FIXED_TIME_GRACE_MS = 10 * MINUTE_MS;

/**
 * True when a due wall-clock run (fixed time, one-off or cron) was missed by more than the grace
 * window and should be rescheduled to its next occurrence instead of firing now. Interval
 * schedules are never considered missed: an overdue interval task catching up with a single run
 * is the desired behaviour.
 */
export function isMissedFixedTimeRun(
  schedule: ScheduledTaskSchedule,
  dueAt: DateTime.DateTime,
  now: DateTime.DateTime,
): boolean {
  if (schedule.type !== "fixed_time" && schedule.type !== "once" && schedule.type !== "cron") {
    return false;
  }
  return DateTime.toEpochMillis(now) - DateTime.toEpochMillis(dueAt) > MISSED_FIXED_TIME_GRACE_MS;
}
