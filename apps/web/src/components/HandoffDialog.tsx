import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  HandoffPreview,
  HandoffReason,
  ModelSelection,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@moonfold/contracts";
import { nextHandoffTarget } from "@moonfold/contracts";
import { resolveProjectSettings } from "@moonfold/shared/projectSettings";
import { ArrowRightLeftIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";

import { useEnvironmentSettings } from "../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../modelSelection";
import { providerInstanceEntriesFor } from "../providerInstances";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { ProviderModelPicker } from "./chat/ProviderModelPicker";
import { handoffRedactionSummary } from "./handoffDialog.logic";
import { defaultModelSlug } from "./settings/handoffSettings.logic";
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
import { Spinner } from "./ui/spinner";
import { stackedThreadToast, toastManager } from "./ui/toast";

export interface HandoffRequest {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId | null;
  /** The selection the thread is on now. */
  readonly current: ModelSelection;
  readonly reason: HandoffReason;
  /** Preselected target; the first fallback when absent. */
  readonly target?: ModelSelection;
}

const useRequest = create<{ request: HandoffRequest | null }>(() => ({ request: null }));

/** Opens the "Hand off to…" dialog for a thread; the host in the root route renders it. */
export function requestHandoff(request: HandoffRequest) {
  useRequest.setState({ request });
}

export function HandoffDialogHost() {
  const request = useRequest((state) => state.request);
  return request ? (
    <HandoffDialog
      key={`${request.environmentId}:${request.threadId}`}
      request={request}
      onClose={() => useRequest.setState({ request: null })}
    />
  ) : null;
}

function HandoffDialog({ request, onClose }: { request: HandoffRequest; onClose: () => void }) {
  const settings = useEnvironmentSettings(request.environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(request.environmentId)) ??
    EMPTY_SERVER_PROVIDERS;
  const instanceEntries = providerInstanceEntriesFor(providers, settings, request.projectId);
  const [target, setTarget] = useState<ModelSelection | null>(() => {
    if (request.target !== undefined) return request.target;
    const project = resolveProjectSettings(settings, request.projectId).settings;
    const enabled = new Set(
      instanceEntries.filter((entry) => entry.enabled).map((entry) => entry.instanceId),
    );
    return (
      nextHandoffTarget({
        settings: project.providerHandoff,
        current: request.current,
        isAvailable: (selection) => enabled.has(selection.instanceId),
      }) ??
      (() => {
        const other = instanceEntries.find(
          (entry) => entry.enabled && entry.instanceId !== request.current.instanceId,
        );
        if (other === undefined) return null;
        const model = defaultModelSlug(
          getCustomModelOptionsByInstance(settings, providers, other.instanceId).get(
            other.instanceId,
          ),
        );
        return model === null ? null : { instanceId: other.instanceId, model };
      })()
    );
  });
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    providers,
    target?.instanceId ?? request.current.instanceId,
    target?.model ?? "",
  );
  const previewHandoff = useAtomCommand(serverEnvironment.previewHandoff, {
    label: "handoff preview",
    reportFailure: false,
  });
  const startHandoff = useAtomCommand(serverEnvironment.startHandoff, { label: "handoff" });
  // The latest settled preview, keyed by the target it was built for, so a stale one never shows.
  const [settled, setSettled] = useState<{
    readonly key: string;
    readonly preview: HandoffPreview | null;
    readonly error: string | null;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const targetKey = target === null ? null : `${target.instanceId}:${target.model}`;
  const preview = settled !== null && settled.key === targetKey ? settled.preview : null;
  const previewError = settled !== null && settled.key === targetKey ? settled.error : null;

  // oxlint-disable-next-line moonfold/no-unreasoned-state-sync -- asks the server to build the handoff brief for the chosen target and ignores answers for an earlier target
  useEffect(() => {
    if (target === null || target.model === "" || targetKey === null) return;
    let current = true;
    void previewHandoff({
      environmentId: request.environmentId,
      input: { threadId: request.threadId, target, reason: request.reason },
    }).then((result) => {
      if (!current) return;
      setSettled(
        result._tag === "Success"
          ? { key: targetKey, preview: result.value, error: null }
          : {
              key: targetKey,
              preview: null,
              error: "The preview could not be built. Check the connection and try again.",
            },
      );
    });
    return () => {
      current = false;
    };
  }, [previewHandoff, request.environmentId, request.threadId, request.reason, target, targetKey]);

  const send = async () => {
    if (target === null || preview === null || preview.blockedReason !== null) return;
    setSending(true);
    const result = await startHandoff({
      environmentId: request.environmentId,
      input: { threadId: request.threadId, target, reason: request.reason },
    });
    setSending(false);
    if (result._tag === "Success") {
      onClose();
      return;
    }
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not hand off the thread",
        description: "Nothing was sent. Try again in a moment.",
      }),
    );
  };

  const redactions = preview === null ? null : handoffRedactionSummary(preview.redactions);
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !sending) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Hand off to another agent</DialogTitle>
          <DialogDescription>
            The thread continues in the agent you pick. It receives the brief below, then the
            earlier conversation.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <ArrowRightLeftIcon aria-hidden className="size-4 text-muted-foreground" />
              <ProviderModelPicker
                environmentId={request.environmentId}
                activeInstanceId={
                  (target?.instanceId ?? request.current.instanceId) as ProviderInstanceId
                }
                model={target?.model ?? ""}
                lockedProvider={null}
                instanceEntries={instanceEntries}
                modelOptionsByInstance={modelOptionsByInstance}
                isComposerOwned={false}
                disabled={sending}
                triggerAriaLabel="Agent to continue with"
                onInstanceModelChange={(instanceId, model) => setTarget({ instanceId, model })}
              />
            </div>
            {target === null || target.model === "" ? (
              <p className="text-sm text-muted-foreground">
                Pick the agent and model to continue with.
              </p>
            ) : previewError !== null ? (
              <p role="alert" className="text-sm text-destructive-foreground">
                {previewError}
              </p>
            ) : preview === null ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Spinner className="size-4" /> Building the brief…
              </div>
            ) : (
              <>
                {preview.blockedReason !== null ? (
                  <p role="alert" className="text-sm text-destructive-foreground">
                    {preview.blockedReason}
                  </p>
                ) : null}
                <section className="space-y-1.5" aria-label="Brief">
                  <h3 className="text-sm font-medium">What will be sent</h3>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 font-mono text-xs">
                    {preview.brief}
                  </pre>
                </section>
                <p className="text-xs text-muted-foreground">
                  {redactions ?? "No keys, tokens or passwords were found."} Up to{" "}
                  {preview.historyMessages} earlier messages follow the brief, as many as fit the
                  model's context, with the same redaction.
                </p>
              </>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={sending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={sending || preview === null || preview.blockedReason !== null}
            onClick={() => void send()}
          >
            {sending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export interface HandoffBriefRequest {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly contextHandoffId: string;
}

const useBriefRequest = create<{ request: HandoffBriefRequest | null }>(() => ({ request: null }));

/** Shows the brief a past handoff sent; the host in the root route renders it. */
export function requestHandoffBrief(request: HandoffBriefRequest) {
  useBriefRequest.setState({ request });
}

export function HandoffBriefDialogHost() {
  const request = useBriefRequest((state) => state.request);
  return request ? (
    <HandoffBriefDialog
      key={request.contextHandoffId}
      request={request}
      onClose={() => useBriefRequest.setState({ request: null })}
    />
  ) : null;
}

function HandoffBriefDialog({
  request,
  onClose,
}: {
  request: HandoffBriefRequest;
  onClose: () => void;
}) {
  const readBrief = useAtomCommand(serverEnvironment.readHandoffBrief, {
    label: "handoff brief",
    reportFailure: false,
  });
  const [brief, setBrief] = useState<{ text: string } | null | "missing">(null);
  // oxlint-disable-next-line moonfold/no-unreasoned-state-sync -- reads the brief a past handoff sent from the server and ignores the answer once the dialog closes
  useEffect(() => {
    let current = true;
    void readBrief({
      environmentId: request.environmentId,
      input: { threadId: request.threadId, contextHandoffId: request.contextHandoffId },
    }).then((result) => {
      if (!current) return;
      setBrief(result._tag === "Success" && result.value !== null ? result.value : "missing");
    });
    return () => {
      current = false;
    };
  }, [readBrief, request]);
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Handoff brief</DialogTitle>
          <DialogDescription>What the next agent received, after redaction.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {brief === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Spinner className="size-4" /> Loading…
            </div>
          ) : brief === "missing" ? (
            <p className="text-sm text-muted-foreground">
              No brief was recorded for this handoff. It may not have been sent yet.
            </p>
          ) : (
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 font-mono text-xs">
              {brief.text}
            </pre>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
