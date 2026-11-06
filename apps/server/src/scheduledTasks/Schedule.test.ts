import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import {
  isMissedFixedTimeRun,
  isSameSchedule,
  nextScheduledRunAt,
  scheduleProblem,
} from "./Schedule.ts";

describe("scheduled task schedule calculation", () => {
  it("skips to the next matching fixed-time weekday", () => {
    const next = nextScheduledRunAt(
      { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] },
      DateTime.makeZonedUnsafe(
        {
          year: 2026,
          month: 7,
          day: 3,
          hour: 10,
          minute: 0,
          second: 0,
          millisecond: 0,
        },
        { timeZone: "America/Los_Angeles", adjustForTimeZone: true },
      ),
    );
    const parts = next ? DateTime.toParts(next) : null;
    expect(parts?.weekDay).toBe(1);
    expect(parts?.hour).toBe(9);
    expect(parts?.minute).toBe(0);
  });

  it("compares schedules structurally", () => {
    expect(
      isSameSchedule(
        { type: "once", runAt: "2026-11-01T03:00:00-05:00" },
        { type: "once", runAt: "2026-11-01T08:00:00.000Z" },
      ),
    ).toBe(true);
    expect(
      isSameSchedule({ type: "interval", everyMs: 60_000 }, { type: "interval", everyMs: 60_000 }),
    ).toBe(true);
    expect(
      isSameSchedule({ type: "interval", everyMs: 60_000 }, { type: "interval", everyMs: 30_000 }),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [5, 1] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 5, 5] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00" },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [] },
        { type: "fixed_time", timeOfDay: "09:00" },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 3] },
      ),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00" },
        { type: "fixed_time", timeOfDay: "09:30" },
      ),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "interval", everyMs: 60_000 },
        { type: "fixed_time", timeOfDay: "09:00" },
      ),
    ).toBe(false);
  });
});

describe("one-off and cron schedules", () => {
  const iso = (value: DateTime.DateTime | null) =>
    value === null ? null : DateTime.formatIso(DateTime.toUtc(value));
  const once = { type: "once", runAt: "2026-11-02T08:15:00+01:00" } as const;

  it("runs a one-off once, at its time, and never again", () => {
    expect(iso(nextScheduledRunAt(once, DateTime.makeUnsafe("2026-10-19T00:00:00.000Z")))).toBe(
      "2026-11-02T07:15:00.000Z",
    );
    expect(nextScheduledRunAt(once, DateTime.makeUnsafe("2026-11-02T07:15:00.000Z"))).toBeNull();
  });

  it("reads cron in the task's time zone and stops after its end", () => {
    const cron = {
      type: "cron",
      expression: "0 9 * * 1-5",
      timeZone: "Asia/Kolkata",
      until: "2026-10-20T23:59:59.000Z",
    } as const;
    // Monday 2026-10-19, 09:00 in Kolkata is 03:30 UTC.
    expect(iso(nextScheduledRunAt(cron, DateTime.makeUnsafe("2026-10-19T00:00:00.000Z")))).toBe(
      "2026-10-19T03:30:00.000Z",
    );
    expect(iso(nextScheduledRunAt(cron, DateTime.makeUnsafe("2026-10-19T03:30:00.000Z")))).toBe(
      "2026-10-20T03:30:00.000Z",
    );
    expect(nextScheduledRunAt(cron, DateTime.makeUnsafe("2026-10-20T03:30:00.000Z"))).toBeNull();
  });

  it("reports invalid expressions and zones instead of scheduling them", () => {
    expect(scheduleProblem({ type: "cron", expression: "0 9 * *", timeZone: "UTC" })).toMatch(
      /five fields/,
    );
    expect(
      scheduleProblem({ type: "cron", expression: "0 9 * * *", timeZone: "Atlantis/Capital" }),
    ).toMatch(/Unknown time zone/);
    expect(scheduleProblem(once)).toBeNull();
  });

  it("treats only a time-zone, end or normalized-expression change as a new schedule", () => {
    const cron = { type: "cron", expression: "0 9 * * *", timeZone: "UTC" } as const;
    expect(isSameSchedule(cron, { ...cron, expression: " 0  9 * * * " })).toBe(true);
    expect(isSameSchedule(cron, { ...cron, timeZone: "Europe/Berlin" })).toBe(false);
    expect(isSameSchedule(cron, { ...cron, until: "2026-12-31T00:00:00.000Z" })).toBe(false);
  });

  it("skips a one-off or cron run missed by more than the grace window", () => {
    const due = DateTime.makeUnsafe("2026-11-02T07:15:00.000Z");
    expect(isMissedFixedTimeRun(once, due, DateTime.makeUnsafe("2026-11-02T07:20:00.000Z"))).toBe(
      false,
    );
    expect(isMissedFixedTimeRun(once, due, DateTime.makeUnsafe("2026-11-02T09:00:00.000Z"))).toBe(
      true,
    );
  });
});
