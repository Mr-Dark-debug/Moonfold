import { describe, expect, it } from "vite-plus/test";

import {
  defaultScheduledSendTime,
  fromDateTimeInputs,
  isTimedCommand,
  parseTimedCommand,
  scheduledSendTitle,
} from "./scheduledSend.logic";

// Tuesday 2026-10-27, 10:20 local time.
const now = new Date(2026, 9, 27, 10, 20, 0);
const local = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes);

describe("parseTimedCommand", () => {
  it("ignores messages that are not /timed", () => {
    expect(parseTimedCommand("fix the test", now)).toBeNull();
    expect(parseTimedCommand("/timedout", now)).toBeNull();
    expect(isTimedCommand("  /timed in 5m go")).toBe(true);
  });

  it("reads relative times", () => {
    expect(parseTimedCommand("/timed in 30m fix the test", now)).toEqual({
      at: new Date(now.getTime() + 30 * 60_000),
      text: "fix the test",
    });
    expect(parseTimedCommand("/timed in 2 hours run it", now)?.at).toEqual(
      new Date(now.getTime() + 2 * 3_600_000),
    );
  });

  it("reads clock times, moving a past time to tomorrow", () => {
    expect(parseTimedCommand("/timed at 9pm deploy", now)).toEqual({
      at: local(27, 21),
      text: "deploy",
    });
    expect(parseTimedCommand("/timed 9:30 standup notes", now)).toEqual({
      at: local(28, 9, 30),
      text: "standup notes",
    });
    expect(parseTimedCommand("/timed 12am x", now)?.at).toEqual(local(28, 0));
    expect(parseTimedCommand("/timed 12pm x", now)?.at).toEqual(local(27, 12));
  });

  it("reads today and tomorrow", () => {
    expect(parseTimedCommand("/timed tomorrow 9am fix the failing test", now)).toEqual({
      at: local(28, 9),
      text: "fix the failing test",
    });
    expect(parseTimedCommand("/timed tomorrow at 14:00 ship", now)?.at).toEqual(local(28, 14));
    expect(parseTimedCommand("/timed tomorrow review", now)).toEqual({
      at: local(28, 10, 30),
      text: "review",
    });
  });

  it("leaves the time to the dialog when none was given", () => {
    expect(parseTimedCommand("/timed please continue", now)).toEqual({
      at: null,
      text: "please continue",
    });
    expect(parseTimedCommand("/timed", now)).toEqual({ at: null, text: "" });
    // A bare number is part of the message, not a time.
    expect(parseTimedCommand("/timed 3 bugs to fix", now)).toEqual({
      at: null,
      text: "3 bugs to fix",
    });
  });

  it("rejects impossible clock times", () => {
    expect(parseTimedCommand("/timed at 25:00 x", now)?.at).toBeNull();
    expect(parseTimedCommand("/timed 13pm x", now)?.at).toBeNull();
  });
});

describe("schedule helpers", () => {
  it("reads the date and time inputs as a local time", () => {
    const at = fromDateTimeInputs("2026-10-28", "09:05");
    expect(at).toEqual(local(28, 9, 5));
    expect(fromDateTimeInputs("2026-10-28", "")).toBeNull();
  });

  it("defaults to about half an hour ahead, on a quarter hour", () => {
    expect(defaultScheduledSendTime(now)).toEqual(local(27, 11, 0));
  });

  it("titles the task from the message's first line", () => {
    expect(scheduledSendTitle("Fix the test\nmore detail")).toBe("Scheduled: Fix the test");
    expect(scheduledSendTitle("  ")).toBe("Scheduled message");
  });
});
