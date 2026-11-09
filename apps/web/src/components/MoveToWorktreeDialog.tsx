import type { EnvironmentId } from "@moonfold/contracts";
import { useEffect, useId, useState } from "react";
import { create } from "zustand";

import { useEnvironmentQuery } from "../state/query";
import { vcsEnvironment } from "../state/vcs";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Toggle, ToggleGroup } from "./ui/toggle-group";

export type WorktreeMoveChoice =
  | { readonly branch: string; readonly carryChanges: boolean }
  | { readonly worktreePath: string; readonly carryChanges: boolean };

interface WorktreeMoveRequest {
  readonly environmentId: EnvironmentId;
  /** The project folder the thread works in now. */
  readonly projectCwd: string;
  readonly suggestedBranch: string;
}
type Request = WorktreeMoveRequest & {
  readonly resolve: (choice: WorktreeMoveChoice | null) => void;
};
const useRequest = create<{ request: Request | null }>(() => ({ request: null }));

/**
 * Asks where the thread goes (a new branch or one of the project's existing worktrees) and
 * whether the project folder's uncommitted work goes along.
 */
export function requestWorktreeMove(
  request: WorktreeMoveRequest,
): Promise<WorktreeMoveChoice | null> {
  useRequest.getState().request?.resolve(null);
  return new Promise((resolve) => useRequest.setState({ request: { ...request, resolve } }));
}

function finish(choice: WorktreeMoveChoice | null) {
  const request = useRequest.getState().request;
  useRequest.setState({ request: null });
  request?.resolve(choice);
}

export function MoveToWorktreeDialogHost() {
  const request = useRequest((state) => state.request);
  // oxlint-disable-next-line moonfold/no-unreasoned-state-sync -- settles the caller's pending promise as cancelled when the host unmounts with a request open
  useEffect(() => () => finish(null), []);
  return request ? <MoveToWorktreeDialog request={request} /> : null;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function MoveToWorktreeDialog(props: { readonly request: WorktreeMoveRequest }) {
  const { environmentId, projectCwd, suggestedBranch } = props.request;
  const id = useId();
  const [target, setTarget] = useState<"new" | "existing">("new");
  const [branch, setBranch] = useState(suggestedBranch);
  const [worktreePath, setWorktreePath] = useState<string | null>(null);
  const [carryChanges, setCarryChanges] = useState(true);
  const refs = useEnvironmentQuery(
    vcsEnvironment.listRefs({
      environmentId,
      input: { cwd: projectCwd, refKind: "local", limit: 200 },
    }),
  );
  // Branches checked out somewhere other than the project folder are its other worktrees.
  const worktrees = (refs.data?.refs ?? []).flatMap((ref) =>
    ref.worktreePath !== null && normalizePath(ref.worktreePath) !== normalizePath(projectCwd)
      ? [{ path: ref.worktreePath, branch: ref.name }]
      : [],
  );
  const selectedWorktree = worktrees.find((worktree) => worktree.path === worktreePath) ?? null;
  const trimmed = branch.trim();
  const canSubmit = target === "new" ? trimmed.length > 0 : selectedWorktree !== null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) finish(null);
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            finish(
              target === "new"
                ? { branch: trimmed, carryChanges }
                : { worktreePath: selectedWorktree!.path, carryChanges },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>Move to a worktree</DialogTitle>
            <DialogDescription>
              The thread continues in a checkout of its own, so the project folder is free for other
              work.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <ToggleGroup
                aria-label="Worktree"
                className="w-full *:flex-1"
                value={[target]}
                onValueChange={(next) => {
                  const value = next[0];
                  if (value === "new" || value === "existing") setTarget(value);
                }}
              >
                <Toggle value="new">New branch</Toggle>
                <Toggle value="existing">Existing worktree</Toggle>
              </ToggleGroup>
              {target === "new" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${id}-branch`}>Branch</Label>
                  <Input
                    id={`${id}-branch`}
                    autoFocus
                    value={branch}
                    onChange={(event) => setBranch(event.target.value)}
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${id}-worktree`}>Worktree</Label>
                  {worktrees.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      {refs.data === null || refs.data === undefined
                        ? "Looking for worktrees…"
                        : "This project has no other worktrees yet."}
                    </p>
                  ) : (
                    <Select value={worktreePath} onValueChange={(value) => setWorktreePath(value)}>
                      <SelectTrigger id={`${id}-worktree`} aria-label="Worktree">
                        <SelectValue>
                          {selectedWorktree ? selectedWorktree.branch : "Choose a worktree"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        {worktrees.map((worktree) => (
                          <SelectItem key={worktree.path} value={worktree.path}>
                            <span className="flex flex-col">
                              <span>{worktree.branch}</span>
                              <span className="text-muted-foreground text-xs">{worktree.path}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  )}
                </div>
              )}
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <Checkbox
                  checked={carryChanges}
                  onCheckedChange={(checked) => setCarryChanges(checked === true)}
                />
                <span className="flex flex-col gap-0.5">
                  Take uncommitted changes along
                  <span className="text-xs text-muted-foreground">
                    Changes in the project folder move into the worktree and the folder is left
                    clean.
                  </span>
                </span>
              </label>
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => finish(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              Move thread
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
