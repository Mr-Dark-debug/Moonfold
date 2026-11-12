import { DEFAULT_ORBIT_CONFIG, type OrbitItem, OrbitItemId, ProjectId } from "@moonfold/contracts";
import { describe, expect, it } from "vite-plus/test";

import { backlogItems, crewMarkState, inboxItems, parseLines } from "./orbit.logic";

const item = (overrides: Partial<OrbitItem>): OrbitItem => ({
  id: OrbitItemId.make(`item-${overrides.title ?? "x"}`),
  kind: "finding",
  status: "open",
  title: "x",
  body: "",
  author: "scout",
  url: null,
  source: null,
  rank: 0,
  threadId: null,
  createdAt: "2026-11-12T00:00:00.000Z",
  updatedAt: "2026-11-12T00:00:00.000Z",
  ...overrides,
});

const snapshot = {
  projectId: ProjectId.make("p"),
  config: { ...DEFAULT_ORBIT_CONFIG, enabled: true },
  mission: "m",
  paused: false,
  holdReason: null,
  runsToday: 0,
  crew: [],
  items: [],
  audit: [],
};
const member = {
  role: "scout",
  active: true,
  lastRunAt: null,
  lastRunStatus: "never",
  nextRunAt: null,
  threadId: null,
} as const;

describe("orbit logic", () => {
  it("shows a crew member's state with the living mark's shapes", () => {
    expect(crewMarkState({ ...member, lastRunStatus: "running" }, snapshot)).toBe("working");
    expect(crewMarkState({ ...member, lastRunStatus: "failed" }, snapshot)).toBe("attention");
    expect(crewMarkState(member, { ...snapshot, holdReason: "Paused by the owner." })).toBe(
      "waiting",
    );
    expect(crewMarkState({ ...member, lastRunStatus: "succeeded" }, snapshot)).toBe("done");
    expect(crewMarkState(member, snapshot)).toBe("idle");
  });

  it("keeps quiet reports and signals out of the inbox, and the backlog in rank order", () => {
    const items = [
      item({ title: "report" }),
      item({ title: "quiet", status: "done" }),
      item({ title: "signal", kind: "signal" }),
      item({ title: "second", kind: "backlog", rank: 2 }),
      item({ title: "first", kind: "backlog", rank: -1, author: "owner" }),
      item({ title: "dropped", kind: "backlog", status: "dismissed" }),
    ];
    expect(inboxItems(items).map((entry) => entry.title)).toEqual(["report"]);
    expect(backlogItems(items).map((entry) => entry.title)).toEqual(["first", "second"]);
  });

  it("reads one channel per line", () => {
    expect(parseLines(" budgeting \n\n r/ynab \n", 10)).toEqual(["budgeting", "r/ynab"]);
    expect(parseLines("a\nb\nc", 2)).toEqual(["a", "b"]);
  });
});
