import type {
  ComputerUseActivity,
  ComputerUseAnswer,
  ComputerUsePermissionRequest,
  EnvironmentId,
} from "@moonfold/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@moonfold/client-runtime/state/runtime";
import { MonitorIcon } from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import { useRef, useState } from "react";

import { useThreadShells } from "../state/entities";
import { environmentPresentations } from "../state/presentation";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { stackedThreadToast, toastManager } from "./ui/toast";

const NO_REQUESTS: ReadonlyArray<ComputerUsePermissionRequest> = [];
const NO_ACTIVE: ComputerUseActivity["active"] = [];

/** Each connected environment's pending questions and in-use apps, read from its live atoms. */
const computerUseAtom = Atom.make((get) => {
  const requests: Array<{
    readonly environmentId: EnvironmentId;
    readonly request: ComputerUsePermissionRequest;
  }> = [];
  const active: Array<{
    readonly environmentId: EnvironmentId;
    readonly threadId: string;
    readonly app: string;
  }> = [];
  for (const [environmentId, presentation] of get(environmentPresentations.presentationsAtom)) {
    if (presentation.connection.phase !== "connected") continue;
    const pending = AsyncResult.getOrElse(
      get(serverEnvironment.computerUsePending({ environmentId, input: {} })),
      () => null,
    );
    const activity = AsyncResult.getOrElse(
      get(serverEnvironment.computerUseActivity({ environmentId, input: {} })),
      () => null,
    );
    for (const request of pending?.requests ?? NO_REQUESTS)
      requests.push({ environmentId, request });
    for (const entry of activity?.active ?? NO_ACTIVE) active.push({ environmentId, ...entry });
  }
  return {
    firstRequest:
      requests.toSorted((left, right) =>
        left.request.createdAt.localeCompare(right.request.createdAt),
      )[0] ?? null,
    active,
  };
}).pipe(Atom.withLabel("web-computer-use-coordinator"));

/**
 * Computer use as every client sees it: the question when an agent wants an app, and while an
 * agent is using one, which app and thread, with a Stop button that turns computer use off.
 */
export function ComputerUseCoordinator() {
  const { firstRequest, active } = useAtomValue(computerUseAtom);
  return (
    <>
      {firstRequest ? (
        <AppApprovalDialog
          key={firstRequest.request.id}
          environmentId={firstRequest.environmentId}
          request={firstRequest.request}
        />
      ) : null}
      {active.length > 0 ? <InUseIndicator active={active} /> : null}
    </>
  );
}

function useThreadTitle(environmentId: EnvironmentId, threadId: string) {
  const threads = useThreadShells();
  return threads.find((thread) => thread.environmentId === environmentId && thread.id === threadId)
    ?.title;
}

function AppApprovalDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly request: ComputerUsePermissionRequest;
}) {
  const { environmentId, request } = props;
  const answer = useAtomCommand(serverEnvironment.answerComputerUseRequest, {
    label: "computer use answer",
  });
  const [busy, setBusy] = useState(false);
  // Focus starts on Deny: an Enter meant for something else must never approve an app.
  const denyRef = useRef<HTMLButtonElement>(null);
  const threadTitle = useThreadTitle(environmentId, request.threadId);
  const respond = async (value: ComputerUseAnswer) => {
    setBusy(true);
    const result = await answer({ environmentId, input: { id: request.id, answer: value } });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not answer the agent",
          description: String(squashAtomCommandFailure(result)),
        }),
      );
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) void respond("deny");
      }}
    >
      <DialogPopup className="sm:max-w-md" initialFocus={denyRef}>
        <DialogHeader>
          <DialogTitle>Let the agent use {request.app}?</DialogTitle>
          <DialogDescription>
            {threadTitle ? `“${threadTitle}” wants to` : "An agent wants to"} read and operate
            {request.windowTitle ? ` “${request.windowTitle}”` : " this app"}: clicking, typing and
            pressing keys. What it does there can't be undone from Moonfold.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            ref={denyRef}
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void respond("deny")}
          >
            Deny
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void respond("allow_thread")}
          >
            Allow in this chat
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void respond("always_allow")}>
            Always allow
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function InUseIndicator(props: {
  readonly active: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly threadId: string;
    readonly app: string;
  }>;
}) {
  const stop = useAtomCommand(serverEnvironment.stopComputerUse, { label: "computer use stop" });
  const first = props.active[0]!;
  const threadTitle = useThreadTitle(first.environmentId, first.threadId);
  const apps = [...new Set(props.active.map((entry) => entry.app))].join(", ");
  const environments = [...new Set(props.active.map((entry) => entry.environmentId))];
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-popover px-4 py-2 text-sm text-popover-foreground shadow-lg"
    >
      <MonitorIcon className="size-4 shrink-0 text-warning-foreground" />
      <span className="min-w-0 truncate">
        Agent using {apps}
        {threadTitle ? ` · ${threadTitle}` : ""}
      </span>
      <Button
        size="xs"
        variant="destructive"
        onClick={async () => {
          for (const environmentId of environments) {
            const result = await stop({ environmentId, input: {} });
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Could not stop computer use",
                  description: String(squashAtomCommandFailure(result)),
                }),
              );
            }
          }
        }}
      >
        Stop
      </Button>
    </div>
  );
}
