/**
 * Scheduled send (D-55): the `/timed` command's time parsing, and the `once` schedule the dialog
 * saves. Times are the browser's local wall-clock time; the task carries the IANA time zone so the
 * server fires it at that local time.
 */

export interface ParsedTimedCommand {
  /** When to send, or null when the command named no time (the dialog then asks). */
  readonly at: Date | null;
  /** The message to send, with the command and time removed. */
  readonly text: string;
}

const TIMED_COMMAND = /^\/timed(?:\s+|$)/i;
const UNIT_MS: Readonly<Record<string, number>> = {
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
};

/** Whether a composer message is a `/timed` command. */
export function isTimedCommand(text: string): boolean {
  return TIMED_COMMAND.test(text.trimStart());
}

/**
 * Parses `/timed <when> <message>`. Understood forms for `<when>`:
 * `in 30m`, `in 2 hours`, `in 1d`; `at 9`, `at 9:30`, `at 9pm`, `at 21:15`; and the same clock
 * times after `today` or `tomorrow` (`tomorrow 9am`, `tomorrow at 14:00`). A clock time already
 * past today, with no day given, means tomorrow. Anything else is left in the message.
 */
export function parseTimedCommand(text: string, now: Date): ParsedTimedCommand | null {
  const trimmed = text.trimStart();
  const match = TIMED_COMMAND.exec(trimmed);
  if (!match) return null;
  let rest = trimmed.slice(match[0].length);

  const relative = /^in\s+(\d{1,4})\s*([a-z]+)\b\s*/i.exec(rest);
  if (relative) {
    const unit = UNIT_MS[relative[2]!.toLowerCase()];
    if (unit !== undefined) {
      return {
        at: new Date(now.getTime() + Number(relative[1]) * unit),
        text: rest.slice(relative[0].length).trim(),
      };
    }
  }

  let day: "today" | "tomorrow" | null = null;
  const dayMatch = /^(today|tomorrow)\b\s*/i.exec(rest);
  if (dayMatch) {
    day = dayMatch[1]!.toLowerCase() as "today" | "tomorrow";
    rest = rest.slice(dayMatch[0].length);
  }
  const clock = /^(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b\s*/i.exec(rest);
  const hasClock =
    clock !== null && (clock[2] !== undefined || clock[3] !== undefined || /^at\s/i.test(rest));
  if (clock && hasClock) {
    let hours = Number(clock[1]);
    const minutes = clock[2] === undefined ? 0 : Number(clock[2]);
    const meridiem = clock[3]?.toLowerCase();
    if (meridiem !== undefined) {
      if (hours < 1 || hours > 12) return { at: null, text: trimmed.slice(match[0].length).trim() };
      hours = (hours % 12) + (meridiem === "pm" ? 12 : 0);
    }
    if (hours > 23 || minutes > 59)
      return { at: null, text: trimmed.slice(match[0].length).trim() };
    const at = new Date(now);
    at.setHours(hours, minutes, 0, 0);
    if (day === "tomorrow" || (day === null && at.getTime() <= now.getTime())) {
      at.setDate(at.getDate() + 1);
    }
    return { at, text: rest.slice(clock[0].length).trim() };
  }
  if (day !== null) {
    // A day with no clock time: same time of day, rounded up to the next quarter hour.
    const at = new Date(now);
    if (day === "tomorrow") at.setDate(at.getDate() + 1);
    at.setSeconds(0, 0);
    at.setMinutes(Math.ceil((at.getMinutes() + 1) / 15) * 15);
    return { at, text: rest.trim() };
  }
  return { at: null, text: rest.trim() };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** `YYYY-MM-DD` for a date input, in local time. */
export function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `HH:MM` for a time input, in local time. */
export function toTimeInputValue(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The local Date the two inputs describe, or null when either is incomplete. */
export function fromDateTimeInputs(dateValue: string, timeValue: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!dateMatch || !timeMatch) return null;
  const date = new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A short default when the user schedules from the send button with no time yet. */
export function defaultScheduledSendTime(now: Date): Date {
  const at = new Date(now);
  at.setSeconds(0, 0);
  at.setMinutes(Math.ceil((at.getMinutes() + 31) / 15) * 15);
  return at;
}

/** A title for the scheduled task: the message's first line, shortened. */
export function scheduledSendTitle(text: string): string {
  const firstLine = text.trim().split("\n")[0]?.trim() ?? "";
  const short = firstLine.length > 60 ? `${firstLine.slice(0, 57).trimEnd()}…` : firstLine;
  return short === "" ? "Scheduled message" : `Scheduled: ${short}`;
}
