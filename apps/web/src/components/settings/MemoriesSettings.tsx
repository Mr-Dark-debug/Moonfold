import { useAtomValue } from "@effect/atom-react";
import { BookmarkIcon, CheckIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import * as Schema from "effect/Schema";
import {
  type EnvironmentId,
  MAX_MEMORY_LENGTH,
  type Memory,
  MemoryKind,
  MemoryLearning,
  type ProjectId,
  resolveEnvironmentMachineKind,
} from "@moonfold/contracts";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@moonfold/client-runtime/state/runtime";

import { requestConfirmDialog } from "../../confirmDialog";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import type { EnvironmentPresentation } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";

const ALL_PROJECTS = "all";

const isMemoryLearning = Schema.is(MemoryLearning);
const isMemoryKind = Schema.is(MemoryKind);
const MEMORY_LEARNING_ORDER = ["off", "suggest", "auto"] as const;
const MEMORY_LEARNING_LABELS: Record<MemoryLearning, string> = {
  off: "Off",
  suggest: "Suggest",
  auto: "Automatic",
};
const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  preference: "Preference",
  environment: "Setup fact",
};

function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: String(squashAtomCommandFailure(result)),
    }),
  );
}

/** Settings → Memories: what agents remember across conversations, per environment. */
export function MemoriesSettings() {
  const { scope, environments, connectedEnvironments, environment } = useSettingsScope();
  const defaultEnvironment = environment ?? connectedEnvironments[0];
  const [adding, setAdding] = useState<EnvironmentId | null>(null);
  const canAdd = useAtomValue(
    serverEnvironment.upsertMemory.permissionAtom(defaultEnvironment?.environmentId ?? null),
  );
  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Memories"
        variant="plain"
        headerAction={
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={!defaultEnvironment || !canAdd}
            onClick={() => defaultEnvironment && setAdding(defaultEnvironment.environmentId)}
          >
            <PlusIcon className="size-3" />
            Add memory
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">
          Memories are short notes Codex and Claude Code receive at the start of every turn. Add
          your own, or ask an agent to remember something. Other providers do not receive them yet.
        </p>
        {scope.kind === "unavailable" ? (
          <SettingsSection title="Unavailable selection">
            <SettingsRow title={scope.message} />
          </SettingsSection>
        ) : environments.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BookmarkIcon />
              </EmptyMedia>
              <EmptyTitle>No environments available</EmptyTitle>
              <EmptyDescription>Connect an environment to manage its memories.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="space-y-8">
            {environments.map((entry) => (
              <MemoryEnvironmentSection
                key={entry.environmentId}
                environment={entry}
                showEnvironmentHeading={environments.length > 1}
                onAdd={() => setAdding(entry.environmentId)}
              />
            ))}
          </div>
        )}
      </SettingsSection>
      {adding ? (
        <MemoryEditorDialog environmentId={adding} memory={null} onClose={() => setAdding(null)} />
      ) : null}
    </SettingsPageContainer>
  );
}

function MemoryEnvironmentSection({
  environment,
  showEnvironmentHeading,
  onAdd,
}: {
  readonly environment: EnvironmentPresentation;
  readonly showEnvironmentHeading: boolean;
  readonly onAdd: () => void;
}) {
  const { environmentId } = environment;
  const connected =
    environment.connection.phase === "connected" && environment.serverConfig !== null;
  const canWrite = useAtomValue(serverEnvironment.upsertMemory.permissionAtom(environmentId));
  const memoriesQuery = useEnvironmentQuery(
    connected ? serverEnvironment.memories({ environmentId, input: {} }) : null,
  );
  const setEnabled = useAtomCommand(serverEnvironment.setMemoriesEnabled, {
    label: "memories enabled",
  });
  const [editing, setEditing] = useState<Memory | null>(null);
  const [busy, setBusy] = useState(false);
  const allProjects = useProjects();
  const projects = allProjects.filter((project) => project.environmentId === environmentId);
  const data = memoriesQuery.data;

  const toggle = async () => {
    if (!data || busy) return;
    setBusy(true);
    const result = await setEnabled({ environmentId, input: { enabled: !data.enabled } });
    setBusy(false);
    reportFailure("Could not change memories", result);
    memoriesQuery.refresh();
  };
  const setLearning = async (learning: MemoryLearning) => {
    if (!data || busy) return;
    setBusy(true);
    const result = await setEnabled({
      environmentId,
      input: { enabled: data.enabled, learning },
    });
    setBusy(false);
    reportFailure("Could not change memories", result);
    memoriesQuery.refresh();
  };
  // Suggestions first: they are the ones waiting for an answer.
  const ordered = data
    ? [
        ...data.memories.filter((memory) => memory.status === "suggested"),
        ...data.memories.filter((memory) => memory.status !== "suggested"),
      ]
    : [];

  return (
    <SettingsSection
      title={environment.label}
      hideTitle={!showEnvironmentHeading}
      icon={
        <EnvironmentMachineIcon
          kind={resolveEnvironmentMachineKind(environment.serverConfig)}
          className="size-3.5"
        />
      }
      headerAction={
        showEnvironmentHeading && connected && canWrite ? (
          <Button
            size="xs"
            variant="ghost-muted"
            aria-label={`Add a memory to ${environment.label}`}
            onClick={onAdd}
          >
            <PlusIcon className="size-3" />
            Add memory
          </Button>
        ) : undefined
      }
    >
      {!connected ? (
        <SettingsRow
          title="Environment disconnected"
          description={`Reconnect ${environment.label} to manage its memories.`}
        />
      ) : memoriesQuery.error ? (
        <SettingsRow title="Could not load memories" description={memoriesQuery.error} />
      ) : !data ? (
        <SettingsRow title="Loading memories…" role="status" />
      ) : (
        <>
          <SettingsRow
            title="Use memories"
            description="When off, agents receive no memories and cannot save new ones."
            control={
              <Switch
                checked={data.enabled}
                disabled={busy || !canWrite}
                aria-label="Use memories"
                onCheckedChange={() => void toggle()}
              />
            }
          />
          <SettingsRow
            title="Learn from corrections"
            description="When you correct how an agent works in a project, it can note that for next time. Suggestions wait here for you; automatic notes are saved as background, never as instructions."
            control={
              <Select
                value={data.learning}
                disabled={busy || !canWrite || !data.enabled}
                onValueChange={(value) => {
                  if (isMemoryLearning(value)) void setLearning(value);
                }}
              >
                <SelectTrigger size="sm" aria-label="Learn from corrections">
                  <SelectValue>{MEMORY_LEARNING_LABELS[data.learning]}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {MEMORY_LEARNING_ORDER.map((value) => (
                    <SelectItem key={value} value={value}>
                      {MEMORY_LEARNING_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
          {data.memories.length === 0 ? (
            <SettingsRow
              title="No memories yet"
              description="Add one, or tell an agent “remember that…” in a thread."
            />
          ) : (
            ordered.map((memory) => (
              <MemoryRow
                key={memory.id}
                environmentId={environmentId}
                memory={memory}
                projectTitle={
                  memory.projectId === null
                    ? null
                    : (projects.find((project) => project.id === memory.projectId)?.title ??
                      "A removed project")
                }
                canWrite={canWrite}
                onEdit={() => setEditing(memory)}
                onChanged={memoriesQuery.refresh}
              />
            ))
          )}
        </>
      )}
      {editing ? (
        <MemoryEditorDialog
          environmentId={environmentId}
          memory={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </SettingsSection>
  );
}

function MemoryRow({
  environmentId,
  memory,
  projectTitle,
  canWrite,
  onEdit,
  onChanged,
}: {
  readonly environmentId: EnvironmentId;
  readonly memory: Memory;
  readonly projectTitle: string | null;
  readonly canWrite: boolean;
  readonly onEdit: () => void;
  readonly onChanged: () => void;
}) {
  const remove = useAtomCommand(serverEnvironment.deleteMemory, { label: "memory delete" });
  const upsert = useAtomCommand(serverEnvironment.upsertMemory, { label: "memory accept" });
  const [busy, setBusy] = useState(false);
  const suggested = memory.status === "suggested";
  const accept = async () => {
    setBusy(true);
    const result = await upsert({
      environmentId,
      input: { id: memory.id, text: memory.text, projectId: memory.projectId },
    });
    setBusy(false);
    reportFailure("Could not accept the suggestion", result);
    onChanged();
  };
  const dismiss = async () => {
    setBusy(true);
    const result = await remove({ environmentId, input: { id: memory.id } });
    setBusy(false);
    reportFailure("Could not dismiss the suggestion", result);
    onChanged();
  };
  const runRemove = async () => {
    const message = "Delete this memory?\nAgents stop receiving it from their next turn.";
    const confirmed =
      (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message);
    if (!confirmed) return;
    setBusy(true);
    const result = await remove({ environmentId, input: { id: memory.id } });
    setBusy(false);
    reportFailure("Could not delete the memory", result);
    onChanged();
  };
  return (
    <SettingsRow
      title={<span className="whitespace-pre-wrap font-normal">{memory.text}</span>}
      status={
        <div className="flex flex-wrap items-center gap-2">
          <span>{projectTitle ?? "All projects"}</span>
          {suggested ? (
            <Badge variant="warning" size="sm">
              Suggestion
            </Badge>
          ) : memory.source === "agent" ? (
            <Badge variant="info" size="sm">
              Saved by an agent
            </Badge>
          ) : null}
          {memory.kind === "environment" ? (
            <Badge variant="outline" size="sm">
              Setup fact
            </Badge>
          ) : null}
          {memory.source === "agent" && memory.threadId !== null ? (
            <Link
              to="/$environmentId/$threadId"
              params={{ environmentId, threadId: memory.threadId }}
              className="text-primary underline-offset-2 hover:underline"
            >
              Open thread
            </Link>
          ) : null}
          <span className="text-muted-foreground">{formatRelativeTimeLabel(memory.updatedAt)}</span>
        </div>
      }
      control={
        <div className="flex items-center gap-1">
          {suggested ? (
            <>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={busy || !canWrite}
                aria-label="Accept suggestion"
                onClick={() => void accept()}
              >
                <CheckIcon className="size-4" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={busy || !canWrite}
                aria-label="Dismiss suggestion"
                onClick={() => void dismiss()}
              >
                <XIcon className="size-4" />
              </Button>
            </>
          ) : null}
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={busy || !canWrite}
            aria-label="Edit memory"
            onClick={onEdit}
          >
            <PencilIcon className="size-4" />
          </Button>
          {suggested ? null : (
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={busy || !canWrite}
              aria-label="Delete memory"
              onClick={() => void runRemove()}
            >
              <Trash2Icon className="size-4" />
            </Button>
          )}
        </div>
      }
    />
  );
}

function MemoryEditorDialog({
  environmentId,
  memory,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly memory: Memory | null;
  readonly onClose: () => void;
}) {
  const allProjects = useProjects();
  const projects = allProjects.filter((project) => project.environmentId === environmentId);
  // The same query the list reads, so saving refreshes the list.
  const memoriesQuery = useEnvironmentQuery(
    serverEnvironment.memories({ environmentId, input: {} }),
  );
  const [text, setText] = useState(memory?.text ?? "");
  const [projectId, setProjectId] = useState<string>(memory?.projectId ?? ALL_PROJECTS);
  const [kind, setKind] = useState<MemoryKind>(memory?.kind ?? "preference");
  const [saving, setSaving] = useState(false);
  const upsert = useAtomCommand(serverEnvironment.upsertMemory, { label: "memory save" });
  const selectedProject = projects.find((project) => project.id === projectId);
  const trimmed = text.trim();

  const submit = async () => {
    if (trimmed.length === 0 || saving) return;
    setSaving(true);
    const result = await upsert({
      environmentId,
      input: {
        ...(memory === null ? {} : { id: memory.id }),
        text: trimmed,
        projectId: projectId === ALL_PROJECTS ? null : (projectId as ProjectId),
        kind,
      },
    });
    setSaving(false);
    if (result._tag === "Failure") {
      reportFailure("Could not save the memory", result);
      return;
    }
    memoriesQuery.refresh();
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
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{memory === null ? "Add memory" : "Edit memory"}</DialogTitle>
            <DialogDescription>
              Write it the way you would tell a colleague, in one or two sentences.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="memory-text">Memory</Label>
                <Textarea
                  id="memory-text"
                  value={text}
                  maxLength={MAX_MEMORY_LENGTH}
                  placeholder="I use pnpm, never npm."
                  autoFocus
                  onChange={(event) => setText(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="memory-project">Applies to</Label>
                <Select
                  value={projectId}
                  onValueChange={(value) => setProjectId(value ?? ALL_PROJECTS)}
                >
                  <SelectTrigger size="sm" id="memory-project">
                    <SelectValue>
                      {projectId === ALL_PROJECTS
                        ? "All projects"
                        : (selectedProject?.title ?? "A removed project")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.title}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="memory-kind">Kind</Label>
                <Select
                  value={kind}
                  onValueChange={(value) => {
                    if (isMemoryKind(value)) setKind(value);
                  }}
                >
                  <SelectTrigger size="sm" id="memory-kind">
                    <SelectValue>{MEMORY_KIND_LABELS[kind]}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="preference">Preference: how you like things done</SelectItem>
                    <SelectItem value="environment">
                      Setup fact: a command or requirement of the project
                    </SelectItem>
                  </SelectPopup>
                </Select>
              </div>
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" size="sm" disabled={saving} />}>
              Cancel
            </DialogClose>
            <Button type="submit" size="sm" disabled={trimmed.length === 0 || saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
