import { useAtomValue } from "@effect/atom-react";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type ProviderInstanceId,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ScheduledTaskUpsertInput,
  type ThreadId,
} from "@moonfold/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@moonfold/client-runtime/state/runtime";
import { CalendarClockIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { create } from "zustand";

import { useEnvironmentSettings } from "../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../providerInstances";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../state/server";
import { readEnvironmentScope } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";
import { ProviderModelPicker } from "./chat/ProviderModelPicker";
import {
  defaultScheduledSendTime,
  fromDateTimeInputs,
  scheduledSendTitle,
  toDateInputValue,
  toTimeInputValue,
} from "./chat/scheduledSend.logic";
import { Button } from "./ui/button";
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
import { Textarea } from "./ui/textarea";
import { stackedThreadToast, toastManager } from "./ui/toast";

export interface ScheduleSendRequest {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly text: string;
  /** Prefilled time, from `/timed` or a usage limit's reset; about half an hour ahead otherwise. */
  readonly at?: Date | null;
  /** The composer's selection: agent, model and its options (reasoning effort and the like). */
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  /** The draft holds images, files or other context a scheduled message cannot carry. */
  readonly hasAttachments: boolean;
  /** Called once the message is scheduled, so the composer can clear its draft. */
  readonly onScheduled?: () => void;
}

const useRequest = create<{ request: ScheduleSendRequest | null }>(() => ({ request: null }));

/**
 * Opens "Schedule send" for a thread (D-55): right-click on Send, `/timed`, or a usage limit's
 * "Schedule for reset". The host in the root route renders it.
 */
export function requestScheduleSend(request: ScheduleSendRequest) {
  useRequest.setState({ request });
}

export function ScheduleSendDialogHost() {
  const request = useRequest((state) => state.request);
  return request ? (
    <ScheduleSendDialog
      key={`${request.environmentId}:${request.threadId}`}
      request={request}
      onClose={() => useRequest.setState({ request: null })}
    />
  ) : null;
}

function ScheduleSendDialog({
  request,
  onClose,
}: {
  request: ScheduleSendRequest;
  onClose: () => void;
}) {
  const settings = useEnvironmentSettings(request.environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(request.environmentId)) ??
    EMPTY_SERVER_PROVIDERS;
  const instanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(
          deriveProviderInstanceEntries(providers),
          settings,
          request.projectId,
        ),
      ),
    [providers, settings, request.projectId],
  );
  // Read once: rendering must not depend on the clock.
  const [openedAt] = useState(() => new Date());
  const initialAt = request.at ?? defaultScheduledSendTime(openedAt);
  const [text, setText] = useState(request.text);
  const [date, setDate] = useState(toDateInputValue(initialAt));
  const [time, setTime] = useState(toTimeInputValue(initialAt));
  const [selection, setSelection] = useState<ModelSelection>(request.modelSelection);
  const [saving, setSaving] = useState(false);
  const modelOptionsByInstance = useMemo(
    () =>
      getCustomModelOptionsByInstance(settings, providers, selection.instanceId, selection.model),
    [settings, providers, selection],
  );
  const upsertTask = useAtomCommand(serverEnvironment.upsertScheduledTask, {
    label: "schedule send",
    reportFailure: false,
  });

  const at = fromDateTimeInputs(date, time);
  const problem =
    text.trim() === ""
      ? "Write the message to send."
      : at === null
        ? "Pick a date and time."
        : at.getTime() <= openedAt.getTime()
          ? "Pick a time in the future."
          : null;
  const canOperate = readEnvironmentScope(request.environmentId, AuthOrchestrationOperateScope);

  const schedule = async () => {
    if (problem !== null || at === null || saving || !canOperate) return;
    if (at.getTime() <= Date.now()) {
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: "That time has passed",
          description: "Pick a time in the future.",
        }),
      );
      return;
    }
    // Keep the composer's options (reasoning effort and the like) while the same model is picked.
    const modelSelection =
      selection.instanceId === request.modelSelection.instanceId &&
      selection.model === request.modelSelection.model
        ? request.modelSelection
        : { instanceId: selection.instanceId, model: selection.model };
    const input: ScheduledTaskUpsertInput = {
      title: scheduledSendTitle(text),
      prompt: text.trim(),
      enabled: true,
      schedule: { type: "once", runAt: at.toISOString() },
      projectId: request.projectId,
      threadId: request.threadId,
      workspaceStrategy: { type: "root" },
      modelSelection,
      runtimeMode: request.runtimeMode,
      interactionMode: request.interactionMode,
      creationSource: "web",
      notify: "failures",
    };
    setSaving(true);
    const result = await upsertTask({ environmentId: request.environmentId, input });
    setSaving(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not schedule the message",
            description: error instanceof Error ? error.message : "The environment did not answer.",
          }),
        );
      }
      return;
    }
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: "Message scheduled",
        description: `Sends ${at.toLocaleString(undefined, {
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        })}.`,
      }),
    );
    request.onScheduled?.();
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule send</DialogTitle>
          <DialogDescription>
            The message is sent to this thread at the time you pick, even if Moonfold restarts in
            between. If an agent is still working then, it waits its turn.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-3">
            <Textarea
              aria-label="Message"
              rows={4}
              value={text}
              disabled={saving}
              onChange={(event) => setText(event.target.value)}
            />
            <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-2">
              <CalendarClockIcon aria-hidden className="size-4 text-muted-foreground" />
              <Input
                type="date"
                aria-label="Date"
                value={date}
                min={toDateInputValue(openedAt)}
                disabled={saving}
                onChange={(event) => setDate(event.target.value)}
              />
              <Input
                type="time"
                aria-label="Time"
                value={time}
                disabled={saving}
                onChange={(event) => setTime(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>Send with</span>
              <ProviderModelPicker
                environmentId={request.environmentId}
                activeInstanceId={selection.instanceId as ProviderInstanceId}
                model={selection.model}
                lockedProvider={null}
                instanceEntries={instanceEntries}
                modelOptionsByInstance={modelOptionsByInstance}
                isComposerOwned={false}
                disabled={saving}
                triggerAriaLabel="Agent and model to send with"
                onInstanceModelChange={(instanceId, model) => setSelection({ instanceId, model })}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Reasoning effort and other options follow the composer while the same model is picked.
              If that agent is at its usage limit when the message is sent, the thread's handoff
              settings apply.
            </p>
            {request.hasAttachments ? (
              <p role="alert" className="text-xs text-warning-foreground">
                Scheduled messages carry text only. Attachments and added context stay in the
                composer and are not sent.
              </p>
            ) : null}
            {problem !== null && text.trim() !== "" ? (
              <p className="text-xs text-muted-foreground">{problem}</p>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={saving || problem !== null || !canOperate}
            onClick={() => void schedule()}
          >
            {saving ? "Scheduling…" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
