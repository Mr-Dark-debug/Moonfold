import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ScheduledTask, ThreadId } from "@moonfold/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@moonfold/client-runtime/state/runtime";
import { CalendarClockIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

/** One-off messages waiting to be sent into this thread (D-55), soonest first. */
export function pendingScheduledSends(
  tasks: ReadonlyArray<ScheduledTask>,
  threadId: ThreadId,
): ReadonlyArray<ScheduledTask> {
  return tasks
    .filter(
      (task) =>
        task.threadId === threadId &&
        task.schedule.type === "once" &&
        task.enabled &&
        task.nextRunAt !== null &&
        task.lastRunStatus !== "running",
    )
    .toSorted((a, b) => Date.parse(a.nextRunAt!) - Date.parse(b.nextRunAt!));
}

function failure(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "The environment did not answer.",
    }),
  );
}

/** A banner above the composer for this thread's scheduled messages, with Send now and Cancel. */
export function useScheduledSendBannerItem(
  environmentId: EnvironmentId,
  threadId: ThreadId | null,
): ComposerBannerStackItem | null {
  const tasksQuery = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
  );
  const canOperate = useAtomValue(
    serverEnvironment.runScheduledTaskNow.permissionAtom(environmentId),
  );
  const runNow = useAtomCommand(serverEnvironment.runScheduledTaskNow, {
    label: "send scheduled message now",
    reportFailure: false,
  });
  const setEnabled = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    label: "send scheduled message now",
    reportFailure: false,
  });
  const remove = useAtomCommand(serverEnvironment.deleteScheduledTask, {
    label: "cancel scheduled message",
    reportFailure: false,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const pending =
    threadId === null ? [] : pendingScheduledSends(tasksQuery.data?.tasks ?? [], threadId);
  const next = pending[0];
  if (next === undefined || next.nextRunAt === null) return null;
  const when = new Date(next.nextRunAt).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  const busy = busyId === next.id;
  return {
    id: `scheduled-send:${next.id}`,
    variant: "info",
    group: "attention",
    icon: <CalendarClockIcon />,
    title:
      pending.length === 1
        ? `Message scheduled for ${when}`
        : `${pending.length} messages scheduled, next ${when}`,
    description: next.prompt.length > 120 ? `${next.prompt.slice(0, 117).trimEnd()}…` : next.prompt,
    actions: canOperate ? (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            setBusyId(next.id);
            // Turn the one-off off first: a manual run keeps its future time otherwise, and it
            // would be sent a second time then.
            const disabled = await setEnabled({
              environmentId,
              input: { id: next.id, enabled: false },
            });
            if (disabled._tag === "Failure") {
              setBusyId(null);
              failure("Could not send the message", disabled);
              return;
            }
            const result = await runNow({ environmentId, input: { id: next.id } });
            setBusyId(null);
            if (result._tag === "Failure") failure("Could not send the message", result);
          }}
        >
          Send now
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            setBusyId(next.id);
            const result = await remove({ environmentId, input: { id: next.id } });
            setBusyId(null);
            if (result._tag === "Failure") failure("Could not cancel the message", result);
          }}
        >
          Cancel
        </Button>
      </div>
    ) : null,
  };
}
