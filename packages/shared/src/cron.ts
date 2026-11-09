/**
 * Five-field cron expressions evaluated in an IANA time zone, for scheduled tasks and the task
 * form's preview. Per field: `*`, numbers, ranges `a-b`, steps `*\/n` and `a-b/n`, lists `a,b`,
 * and month and weekday names. Day of week is 0-7 (0 and 7 are Sunday). When both day of month
 * and day of week are restricted, a day matches either one (the classic cron rule).
 */
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

export interface CronSchedule {
  readonly minutes: ReadonlyArray<number>;
  readonly hours: ReadonlyArray<number>;
  readonly daysOfMonth: ReadonlySet<number>;
  readonly months: ReadonlySet<number>;
  readonly daysOfWeek: ReadonlySet<number>;
  readonly dayOfMonthRestricted: boolean;
  readonly dayOfWeekRestricted: boolean;
}

const MONTH_NAMES = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];
const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

interface FieldSpec {
  readonly name: string;
  readonly min: number;
  readonly max: number;
  readonly names?: ReadonlyArray<string>;
  /** First value the names map to (months are 1-based, weekdays 0-based). */
  readonly nameOffset?: number;
}

const FIELDS: ReadonlyArray<FieldSpec> = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: MONTH_NAMES, nameOffset: 1 },
  { name: "day of week", min: 0, max: 7, names: DAY_NAMES, nameOffset: 0 },
];

// @effect-diagnostics-next-line extendsNativeError:off - a local throw sentinel inside synchronous parsing, caught below.
class CronParseError extends Error {}

function parseValue(raw: string, spec: FieldSpec): number {
  const upper = raw.toUpperCase();
  const named = spec.names?.indexOf(upper) ?? -1;
  if (named >= 0) return named + (spec.nameOffset ?? 0);
  if (!/^\d+$/.test(raw)) throw new CronParseError(`"${raw}" is not a valid ${spec.name}.`);
  const value = Number(raw);
  if (value < spec.min || value > spec.max) {
    throw new CronParseError(`${spec.name} must be between ${spec.min} and ${spec.max}.`);
  }
  return value;
}

function parseField(raw: string, spec: FieldSpec): { values: Set<number>; restricted: boolean } {
  const values = new Set<number>();
  for (const part of raw.split(",")) {
    if (part.length === 0) throw new CronParseError(`Empty item in ${spec.name}.`);
    const [range = "", stepRaw] = part.split("/");
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (stepRaw !== undefined && (!/^\d+$/.test(stepRaw) || step < 1)) {
      throw new CronParseError(`"${stepRaw}" is not a valid step in ${spec.name}.`);
    }
    let start: number;
    let end: number;
    if (range === "*") {
      start = spec.min;
      end = spec.max;
    } else if (range.includes("-")) {
      const [from = "", to = ""] = range.split("-");
      start = parseValue(from, spec);
      end = parseValue(to, spec);
      if (end < start)
        throw new CronParseError(`The range ${range} in ${spec.name} runs backwards.`);
    } else {
      start = parseValue(range, spec);
      end = stepRaw === undefined ? start : spec.max;
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return { values, restricted: raw !== "*" };
}

/** Parses a five-field cron expression; throws `CronParseError` with a readable reason. */
export function parseCron(expression: string): CronSchedule {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new CronParseError("Use five fields: minute, hour, day of month, month and day of week.");
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields.map((field, index) =>
    parseField(field, FIELDS[index]!),
  );
  const daysOfWeek = new Set([...dayOfWeek!.values].map((day) => (day === 7 ? 0 : day)));
  return {
    minutes: [...minute!.values].sort((a, b) => a - b),
    hours: [...hour!.values].sort((a, b) => a - b),
    daysOfMonth: dayOfMonth!.values,
    months: month!.values,
    daysOfWeek,
    dayOfMonthRestricted: dayOfMonth!.restricted,
    dayOfWeekRestricted: dayOfWeek!.restricted,
  };
}

/** The reason an expression is invalid, or null when it parses. */
export function cronError(expression: string): string | null {
  try {
    parseCron(expression);
    return null;
  } catch (error) {
    return error instanceof CronParseError ? error.message : "This expression is not valid.";
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  return Option.isSome(DateTime.zoneMakeNamed(timeZone));
}

function dayMatches(schedule: CronSchedule, day: number, weekDay: number): boolean {
  const byMonthDay = schedule.daysOfMonth.has(day);
  const byWeekDay = schedule.daysOfWeek.has(weekDay);
  if (schedule.dayOfMonthRestricted && schedule.dayOfWeekRestricted) return byMonthDay || byWeekDay;
  if (schedule.dayOfMonthRestricted) return byMonthDay;
  if (schedule.dayOfWeekRestricted) return byWeekDay;
  return true;
}

// Long enough for a rule that only matches on 29 February.
const MAX_DAYS_AHEAD = 366 * 8;

/**
 * The first time strictly after `from` that matches the schedule, as wall-clock time in
 * `timeZone`. Times skipped by a daylight-saving jump are skipped. Null when nothing matches
 * within eight years (for example 31 February) or the time zone is unknown.
 */
export function nextCronOccurrence(
  schedule: CronSchedule,
  from: DateTime.DateTime,
  timeZone: string,
): DateTime.Utc | null {
  const zone = DateTime.zoneMakeNamed(timeZone);
  if (Option.isNone(zone)) return null;
  const local = DateTime.setZone(from, zone.value);
  const today = DateTime.toParts(local);
  const fromMillis = DateTime.toEpochMillis(from);
  for (let offset = 0; offset <= MAX_DAYS_AHEAD; offset += 1) {
    // Calendar arithmetic in UTC keeps day steps exact across daylight-saving changes.
    // @effect-diagnostics-next-line globalDate:off -- a pure calendar step, not a clock read.
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    if (!schedule.months.has(month) || !dayMatches(schedule, day, date.getUTCDay())) continue;
    for (const hour of schedule.hours) {
      for (const minute of schedule.minutes) {
        const candidate = DateTime.setParts(local, {
          year,
          month,
          day,
          hour,
          minute,
          second: 0,
          millisecond: 0,
        });
        const parts = DateTime.toParts(candidate);
        if (parts.hour !== hour || parts.minute !== minute || parts.day !== day) continue;
        if (DateTime.toEpochMillis(candidate) > fromMillis) return DateTime.toUtc(candidate);
      }
    }
  }
  return null;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

const WEEKDAY_LABELS = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
];

/** A plain-language summary for common shapes, or null when the expression needs reading as is. */
export function describeCron(expression: string): string | null {
  let schedule: CronSchedule;
  try {
    schedule = parseCron(expression);
  } catch {
    return null;
  }
  const allMonths = schedule.months.size === 12;
  if (!allMonths || schedule.minutes.length !== 1) return null;
  const minute = schedule.minutes[0]!;
  if (
    schedule.hours.length === 24 &&
    !schedule.dayOfMonthRestricted &&
    !schedule.dayOfWeekRestricted
  ) {
    return `Every hour at :${pad(minute)}`;
  }
  if (schedule.hours.length !== 1) return null;
  const time = `${pad(schedule.hours[0]!)}:${pad(minute)}`;
  if (!schedule.dayOfMonthRestricted && !schedule.dayOfWeekRestricted)
    return `Every day at ${time}`;
  if (
    schedule.dayOfMonthRestricted &&
    !schedule.dayOfWeekRestricted &&
    schedule.daysOfMonth.size === 1
  ) {
    return `On day ${[...schedule.daysOfMonth][0]} of every month at ${time}`;
  }
  if (!schedule.dayOfMonthRestricted && schedule.dayOfWeekRestricted) {
    const days = [...schedule.daysOfWeek].sort((a, b) => a - b);
    if (days.join(",") === "1,2,3,4,5") return `Weekdays at ${time}`;
    if (days.length === 1) return `${WEEKDAY_LABELS[days[0]!]} at ${time}`;
    return `${days.map((day) => WEEKDAY_LABELS[day]).join(", ")} at ${time}`;
  }
  return null;
}
