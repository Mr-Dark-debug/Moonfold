import type { ContextMenuItem } from "@moonfold/contracts";
import type { SnoozePreset } from "@moonfold/client-runtime/state/thread-settled";

export type ThreadActionMenuId =
  | "find"
  | "new-thread-on-branch"
  | "filter-by-project"
  | "turn-into-project"
  | "project-settings"
  | "pin"
  | "unpin"
  | "settle"
  | "unsettle"
  | "auto-settle"
  | "auto-settle:enabled"
  | "auto-settle:disabled"
  | "memories"
  | "memories:on"
  | "memories:off"
  | "prompt-profile"
  | `prompt-profile:${string}`
  | "snooze"
  | `snooze:${string}`
  | "unsnooze"
  | "rename"
  | "regenerate-title"
  | "mark-unread"
  | "share-guest"
  | "copy"
  | "copy-path"
  | "copy-branch"
  | "copy-thread"
  | "copy-thread-id"
  | "open-in-window"
  | "schedule-follow-up"
  | "hand-off"
  | "move-to-worktree"
  | "return-to-project"
  | "archive"
  | "delete";

export type DraftActionMenuId =
  | "copy"
  | "copy-path"
  | "copy-branch"
  | "project-settings"
  | "discard";

export function buildDraftActionMenuItems(options: {
  readonly hasPath: boolean;
  readonly hasBranch: boolean;
  readonly hasProject: boolean;
}): ReadonlyArray<ContextMenuItem<DraftActionMenuId>> {
  return [
    {
      id: "copy",
      label: "Copy",
      icon: "copy",
      disabled: !options.hasPath && !options.hasBranch,
      children: [
        ...(options.hasPath ? [{ id: "copy-path" as const, label: "Path", icon: "folder" }] : []),
        ...(options.hasBranch
          ? [{ id: "copy-branch" as const, label: "Branch", icon: "git-branch" }]
          : []),
      ],
    },
    ...(options.hasProject
      ? [{ id: "project-settings" as const, label: "Project settings", icon: "settings" }]
      : []),
    {
      id: "discard",
      label: "Discard draft",
      icon: "trash",
      destructive: true,
      separatorBefore: true,
    },
  ];
}

export interface ThreadActionMenuState {
  readonly canOperate: boolean;
  readonly canFind?: boolean;
  readonly branch: string | null;
  readonly projectFilter: {
    readonly label: string;
    readonly isActive: boolean;
  } | null;
  readonly isPinned: boolean;
  readonly isSettled: boolean;
  readonly autoSettleEnabled: boolean;
  /**
   * Whether the user turned memories off for this thread, or null when the environment's
   * answer is unknown (an older server, or the read failed), which hides the item.
   */
  readonly memoriesOptedOut?: boolean | null;
  /**
   * The thread's prompt profile choice (D-54): the profiles to offer, the default's name, and the
   * thread's own pick (null follows the default). Absent hides the item.
   */
  readonly promptProfile?: {
    readonly threadProfileId: string | null;
    readonly defaultName: string;
    readonly options: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  } | null;
  readonly isSnoozed: boolean;
  readonly canSnoozeNow: boolean;
  readonly isRegeneratingTitle: boolean;
  /** The desktop app can open this thread in a window of its own. */
  readonly canOpenInWindow: boolean;
  /**
   * Where the thread works: the project folder or a worktree of its own. Null when it can move
   * neither way (no git branch, or a server without the move).
   */
  readonly workspace: "project" | "worktree" | null;
  /** Archive rejects attached providers, so disable it while running. */
  readonly isRunning: boolean;
  readonly supports: {
    readonly settlement: boolean;
    readonly autoSettleOptOut: boolean;
    readonly snooze: boolean;
    readonly pinning: boolean;
    readonly titleRegeneration: boolean;
  };
  readonly snoozePresets: ReadonlyArray<SnoozePreset>;
  /** Guest links need their own grant, so the caller checks it instead of `canOperate`. */
  readonly canShareWithGuest?: boolean;
  /** A No project thread with its own folder, on a server that can promote it. */
  readonly canTurnIntoProject?: boolean;
}

/**
 * Which way a thread can move: out of the project folder into a worktree, or back. A thread
 * without a branch is not in a git checkout, and a connection without source-control write
 * access cannot move files at all.
 */
export function threadWorkspaceKind(
  thread: { readonly worktreePath: string | null; readonly branch: string | null },
  canWriteSourceControl: boolean,
): ThreadActionMenuState["workspace"] {
  if (!canWriteSourceControl) return null;
  if (thread.worktreePath !== null) return "worktree";
  return thread.branch !== null ? "project" : null;
}

/** Local navigation, read markers, and copying remain available to read-only clients. */
export function threadActionRequiresOperate(action: ThreadActionMenuId): boolean {
  return ![
    "find",
    "new-thread-on-branch",
    "project-settings",
    "mark-unread",
    "share-guest",
    "copy",
    "copy-path",
    "copy-branch",
    "copy-thread",
    "copy-thread-id",
    "open-in-window",
  ].includes(action);
}

export function buildThreadActionMenuItems(
  state: ThreadActionMenuState,
): ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> {
  const items: ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> = [
    ...(state.canFind
      ? [{ id: "find" as const, label: "Find in thread", icon: "text-search" }]
      : []),
    ...(state.branch
      ? [
          {
            id: "new-thread-on-branch" as const,
            label: `New thread on ${state.branch}`,
            icon: "message-square-plus",
          },
        ]
      : []),
    ...(state.supports.pinning
      ? [
          state.isPinned
            ? { id: "unpin" as const, label: "Unpin thread", icon: "pin-off" }
            : { id: "pin" as const, label: "Pin thread", icon: "pin" },
        ]
      : []),
    ...(state.supports.settlement
      ? [
          state.isSettled
            ? { id: "unsettle" as const, label: "Un-settle thread", icon: "circle-check" }
            : { id: "settle" as const, label: "Settle thread", icon: "circle-check" },
        ]
      : []),
    ...(state.supports.snooze
      ? [
          state.isSnoozed
            ? { id: "unsnooze" as const, label: "Wake thread", icon: "clock" }
            : {
                id: "snooze" as const,
                label: "Snooze",
                icon: "clock",
                disabled: !state.canSnoozeNow,
                children: [
                  ...state.snoozePresets.map((preset) => ({
                    id: `snooze:${preset.id}` as const,
                    label: `${preset.label} (${preset.whenLabel})`,
                  })),
                  {
                    id: "snooze:custom" as const,
                    label: "Custom…",
                    separatorBefore: state.snoozePresets.length > 0,
                  },
                ],
              },
        ]
      : []),
    { id: "rename", label: "Rename thread", icon: "pencil", separatorBefore: true },
    ...(state.supports.titleRegeneration
      ? [
          {
            id: "regenerate-title" as const,
            label: state.isRegeneratingTitle ? "Regenerating…" : "Regenerate title",
            icon: "refresh-cw",
            disabled: state.isRegeneratingTitle,
          },
        ]
      : []),
    { id: "mark-unread", label: "Mark unread", icon: "mail-open" },
    ...(state.canShareWithGuest
      ? [{ id: "share-guest" as const, label: "Share with guest", icon: "user-plus" }]
      : []),
    ...(state.projectFilter
      ? [
          {
            id: "filter-by-project" as const,
            label: state.projectFilter.isActive
              ? "Show all projects"
              : `Filter by ${state.projectFilter.label}`,
            icon: "folder-tree",
          },
        ]
      : []),
    ...(state.canTurnIntoProject
      ? [
          {
            id: "turn-into-project" as const,
            label: "Turn into project",
            icon: "folder-plus",
            disabled: state.isRunning,
          },
        ]
      : []),
    ...(state.supports.autoSettleOptOut
      ? [
          {
            id: "auto-settle" as const,
            label: "Auto-settle behavior",
            icon: "timer",
            children: [
              {
                id: "auto-settle:enabled" as const,
                label: "Enabled",
                checked: state.autoSettleEnabled,
              },
              {
                id: "auto-settle:disabled" as const,
                label: "Disabled",
                checked: !state.autoSettleEnabled,
              },
            ],
          },
        ]
      : []),
    ...(state.memoriesOptedOut === undefined || state.memoriesOptedOut === null
      ? []
      : [
          {
            id: "memories" as const,
            label: "Memories",
            icon: "bookmark",
            children: [
              {
                id: "memories:on" as const,
                label: "Use memories",
                checked: !state.memoriesOptedOut,
              },
              {
                id: "memories:off" as const,
                label: "Don't use memories",
                checked: state.memoriesOptedOut,
              },
            ],
          },
        ]),
    ...(state.promptProfile === undefined || state.promptProfile === null
      ? []
      : [
          {
            id: "prompt-profile" as const,
            label: "Prompt profile",
            icon: "message-square-quote",
            children: [
              {
                id: "prompt-profile:" as const,
                label: `Default (${state.promptProfile.defaultName})`,
                checked: state.promptProfile.threadProfileId === null,
              },
              ...state.promptProfile.options.map((option) => ({
                id: `prompt-profile:${option.id}` as const,
                label: option.name,
                checked: state.promptProfile?.threadProfileId === option.id,
              })),
            ],
          },
        ]),
    { id: "schedule-follow-up", label: "Schedule a follow-up…", icon: "clock" },
    // A turn in flight keeps its provider; the handoff starts once it ends.
    {
      id: "hand-off",
      label: "Hand off to…",
      icon: "arrow-right-left",
      disabled: state.isRunning,
    },
    {
      id: "copy",
      label: "Copy",
      icon: "copy",
      separatorBefore: true,
      children: [
        { id: "copy-path", label: "Path", icon: "folder" },
        ...(state.branch
          ? [{ id: "copy-branch" as const, label: "Branch", icon: "git-branch" }]
          : []),
        { id: "copy-thread", label: "Thread", icon: "message-square" },
        { id: "copy-thread-id", label: "Thread ID", icon: "hash" },
      ],
    },
    ...(state.canOpenInWindow
      ? [{ id: "open-in-window" as const, label: "Open in new window", icon: "app-window" }]
      : []),
    // Moving files under an agent mid-turn would pull its checkout out from under it.
    ...(state.workspace === "project"
      ? [
          {
            id: "move-to-worktree" as const,
            label: "Move to new worktree…",
            icon: "git-branch",
            disabled: state.isRunning,
          },
        ]
      : []),
    ...(state.workspace === "worktree"
      ? [
          {
            id: "return-to-project" as const,
            label: "Bring back to project folder…",
            icon: "folder",
            disabled: state.isRunning,
          },
        ]
      : []),
    { id: "project-settings", label: "Project settings", icon: "settings" },
    {
      id: "archive",
      label: "Archive thread",
      icon: "archive",
      disabled: state.isRunning,
      separatorBefore: true,
    },
    {
      id: "delete",
      label: "Delete",
      destructive: true,
      icon: "trash",
    },
  ];
  return state.canOperate
    ? items
    : items.map((item) =>
        threadActionRequiresOperate(item.id)
          ? {
              ...item,
              disabled: true,
              ...(item.children
                ? { children: item.children.map((child) => ({ ...child, disabled: true })) }
                : {}),
            }
          : item,
      );
}
