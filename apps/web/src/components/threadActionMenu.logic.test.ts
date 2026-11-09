import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  canOperate: true,
  branch: null,
  projectFilter: null,
  isPinned: false,
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  canOpenInWindow: false,
  workspace: null,
  isRunning: false,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

function ids(state: ThreadActionMenuState): string[] {
  return buildThreadActionMenuItems(state).map((item) => item.id);
}

describe("open in new window", () => {
  it("is offered only where the desktop app can open one, and needs no write access", () => {
    expect(ids(baseState)).not.toContain("open-in-window");
    expect(ids({ ...baseState, canOpenInWindow: true })).toContain("open-in-window");
    const readOnly = buildThreadActionMenuItems({
      ...baseState,
      canOperate: false,
      canOpenInWindow: true,
    }).find((item) => item.id === "open-in-window");
    expect(readOnly?.disabled).not.toBe(true);
  });
});

describe("moving between the project folder and a worktree", () => {
  it("offers the way out of the current workspace, and the way back", () => {
    expect(ids(baseState)).not.toContain("move-to-worktree");
    expect(ids(baseState)).not.toContain("return-to-project");
    expect(ids({ ...baseState, workspace: "project" })).toContain("move-to-worktree");
    expect(ids({ ...baseState, workspace: "project" })).not.toContain("return-to-project");
    expect(ids({ ...baseState, workspace: "worktree" })).toContain("return-to-project");
    expect(ids({ ...baseState, workspace: "worktree" })).not.toContain("move-to-worktree");
  });

  it("waits for the agent to finish and needs write access", () => {
    const find = (state: ThreadActionMenuState) =>
      buildThreadActionMenuItems(state).find((item) => item.id === "move-to-worktree");
    expect(find({ ...baseState, workspace: "project" })?.disabled).toBe(false);
    expect(find({ ...baseState, workspace: "project", isRunning: true })?.disabled).toBe(true);
    expect(find({ ...baseState, workspace: "project", canOperate: false })?.disabled).toBe(true);
  });
});

describe("per-thread memories and prompt profile", () => {
  it("shows the thread's memory choice, and hides it when the environment did not answer", () => {
    const optedIn = buildThreadActionMenuItems({ ...baseState, memoriesOptedOut: false });
    expect(optedIn.find((item) => item.id === "memories")?.children).toEqual([
      { id: "memories:on", label: "Use memories", checked: true },
      { id: "memories:off", label: "Don't use memories", checked: false },
    ]);
    const optedOut = buildThreadActionMenuItems({ ...baseState, memoriesOptedOut: true });
    expect(
      optedOut.find((item) => item.id === "memories")?.children?.find((child) => child.checked)?.id,
    ).toBe("memories:off");
    expect(ids({ ...baseState, memoriesOptedOut: null })).not.toContain("memories");
  });

  it("offers the prompt profiles with the thread's pick checked, and Default otherwise", () => {
    const promptProfile = {
      defaultName: "Careful engineer",
      options: [
        { id: "moonfold-default", name: "Moonfold default" },
        { id: "minimal", name: "Minimal" },
      ],
    };
    const following = buildThreadActionMenuItems({
      ...baseState,
      promptProfile: { ...promptProfile, threadProfileId: null },
    }).find((item) => item.id === "prompt-profile");
    expect(following?.children?.[0]).toEqual({
      id: "prompt-profile:",
      label: "Default (Careful engineer)",
      checked: true,
    });
    const picked = buildThreadActionMenuItems({
      ...baseState,
      promptProfile: { ...promptProfile, threadProfileId: "minimal" },
    }).find((item) => item.id === "prompt-profile");
    expect(picked?.children?.find((child) => child.checked)?.id).toBe("prompt-profile:minimal");
    expect(ids({ ...baseState, promptProfile: null })).not.toContain("prompt-profile");
  });

  it("offers a handoff that waits for the running turn", () => {
    const find = (state: ThreadActionMenuState) =>
      buildThreadActionMenuItems(state).find((item) => item.id === "hand-off");
    expect(find(baseState)?.disabled).toBe(false);
    expect(find({ ...baseState, isRunning: true })?.disabled).toBe(true);
  });
});

describe("buildThreadActionMenuItems", () => {
  it.each([false, true])(
    "disables both lifecycle directions without permission (reversed: %s)",
    (reversed) => {
      const items = buildThreadActionMenuItems({
        ...baseState,
        canOperate: false,
        isPinned: reversed,
        isSettled: reversed,
        isSnoozed: reversed,
      });
      const expected = reversed
        ? [
            "unpin",
            "unsettle",
            "unsnooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "schedule-follow-up",
            "hand-off",
            "archive",
            "delete",
          ]
        : [
            "pin",
            "settle",
            "snooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "schedule-follow-up",
            "hand-off",
            "archive",
            "delete",
          ];
      expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(expected);
      expect(
        items.find((item) => item.id === "snooze")?.children?.every((child) => child.disabled) ??
          true,
      ).toBe(true);
    },
  );

  it("disables archive and turning into a project while the thread is running", () => {
    const items = buildThreadActionMenuItems({
      ...baseState,
      isRunning: true,
      canTurnIntoProject: true,
    });
    expect(items.find((item) => item.id === "archive")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "turn-into-project")?.disabled).toBe(true);
  });
});
