import { ScheduledTaskId, ThreadId, type ScheduledTask } from "@moonfold/contracts";
import { describe, expect, it } from "vite-plus/test";

import { pendingScheduledSends } from "./scheduledSendBanner";

const thread = ThreadId.make("thread-1");

const task = (id: string, patch: Partial<Omit<ScheduledTask, "id">> = {}): ScheduledTask =>
  ({
    id: ScheduledTaskId.make(id),
    title: "Scheduled: x",
    prompt: "x",
    enabled: true,
    schedule: { type: "once", runAt: "2026-10-28T09:00:00.000Z" },
    threadId: thread,
    nextRunAt: "2026-10-28T09:00:00.000Z",
    lastRunStatus: "never",
    ...patch,
  }) as ScheduledTask;

describe("pendingScheduledSends", () => {
  it("keeps this thread's waiting one-off messages, soonest first", () => {
    const pending = pendingScheduledSends(
      [
        task("later", { nextRunAt: "2026-10-29T09:00:00.000Z" }),
        task("sooner", { nextRunAt: "2026-10-28T08:00:00.000Z" }),
        task("other-thread", { threadId: ThreadId.make("thread-2") }),
        task("sent", { nextRunAt: null, lastRunStatus: "succeeded" }),
        task("off", { enabled: false }),
        task("sending", { lastRunStatus: "running" }),
        task("recurring", {
          schedule: { type: "cron", expression: "0 9 * * *", timeZone: "UTC" },
        }),
      ],
      thread,
    );
    expect(pending.map((entry) => entry.id)).toEqual(["sooner", "later"]);
  });
});
