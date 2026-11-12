import type { OrbitCrewMember, OrbitItem, OrbitRole, OrbitSnapshot } from "@moonfold/contracts";

import type { LivingMarkState } from "../brand/LivingMark";

export const ROLE_LABELS: Record<OrbitRole, string> = {
  scout: "Scout",
  planner: "Planner",
  builder: "Builder",
  sentinel: "Sentinel",
  herald: "Herald",
};

export const ROLE_DUTIES: Record<OrbitRole, string> = {
  scout: "Reads what users say on your channels",
  planner: "Turns it into a ranked backlog",
  builder: "Builds the top item and opens a pull request",
  sentinel: "Checks security every day",
  herald: "Writes release notes and announcements",
};

/** A crew member as the living mark shows it: running, waiting on the owner, failed, or at rest. */
export function crewMarkState(member: OrbitCrewMember, snapshot: OrbitSnapshot): LivingMarkState {
  if (member.lastRunStatus === "running") return "working";
  if (member.lastRunStatus === "failed") return "attention";
  if (snapshot.config.enabled && snapshot.holdReason !== null) return "waiting";
  if (member.lastRunStatus === "succeeded") return "done";
  return "idle";
}

/** The inbox: what needs a look, newest first. Signals and backlog have their own lists. */
export function inboxItems(items: ReadonlyArray<OrbitItem>): ReadonlyArray<OrbitItem> {
  return items
    .filter(
      (item) =>
        (item.kind === "finding" || item.kind === "question" || item.kind === "draft") &&
        item.status === "open",
    )
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function backlogItems(items: ReadonlyArray<OrbitItem>): ReadonlyArray<OrbitItem> {
  return items
    .filter(
      (item) =>
        item.kind === "backlog" && (item.status === "open" || item.status === "in_progress"),
    )
    .toSorted((left, right) => left.rank - right.rank);
}

export const openSignalCount = (items: ReadonlyArray<OrbitItem>) =>
  items.filter((item) => item.kind === "signal" && item.status === "open").length;

/** One line per entry, trimmed, empty lines dropped: how the channel fields are edited. */
export function parseLines(text: string, max: number): ReadonlyArray<string> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .slice(0, max);
}
