import {
  AuthSettingsWriteScope,
  type AgentInstructionsFile,
  type AgentInstructionsFileId,
  type EnvironmentId,
  type ProjectId,
} from "@moonfold/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@moonfold/client-runtime/state/runtime";
import { useEffect, useState } from "react";

import { useProjects } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const USER_LEVEL = "user";
const commandOptions = { reportFailure: false, reportDefect: false } as const;

const FILE_COPY: Readonly<Record<AgentInstructionsFileId, { title: string; description: string }>> =
  {
    "project-agents": {
      title: "Project AGENTS.md",
      description: "Read by Codex and most agents when they work in this project.",
    },
    "project-claude": {
      title: "Project CLAUDE.md",
      description: "Read by Claude Code when it works in this project.",
    },
    "user-codex": {
      title: "Your Codex instructions",
      description: "Codex reads these in every project, before the project's own.",
    },
    "user-claude": {
      title: "Your Claude instructions",
      description: "Claude Code reads these in every project, before the project's own.",
    },
  };

function failureMessage(result: AtomCommandResult<unknown, unknown>): string | null {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "The environment did not answer.";
}

/**
 * Settings > Personalization: the instruction files agents read on their own,
 * edited in place on the environment that runs the agents.
 */
export function PersonalizationSettingsPanel() {
  const { connectedEnvironments } = useSettingsScope();
  const projects = useProjects();
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(null);
  const activeEnvironmentId =
    connectedEnvironments.find((environment) => environment.environmentId === environmentId)
      ?.environmentId ??
    connectedEnvironments[0]?.environmentId ??
    null;
  const environmentProjects = projects
    .filter((project) => project.environmentId === activeEnvironmentId)
    .toSorted((a, b) => a.title.localeCompare(b.title));
  const [projectChoice, setProjectChoice] = useState<string>(USER_LEVEL);
  const projectId = environmentProjects.find((project) => project.id === projectChoice)?.id;

  return (
    <SettingsPageContainer>
      <SettingsSection {...searchableSetting("personalization")} title="Agent instructions">
        <SettingsRow
          title="Where the instructions apply"
          description="Agents read these files from the computer running the environment."
          control={
            <div className="flex flex-wrap justify-end gap-2">
              {connectedEnvironments.length > 1 ? (
                <Select
                  value={activeEnvironmentId ?? ""}
                  onValueChange={(value) => {
                    setEnvironmentId((value as EnvironmentId | null) ?? null);
                    setProjectChoice(USER_LEVEL);
                  }}
                >
                  <SelectTrigger className="w-44" aria-label="Environment">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {connectedEnvironments.map((environment) => (
                      <SelectItem key={environment.environmentId} value={environment.environmentId}>
                        {environment.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              ) : null}
              <Select
                value={projectId ?? USER_LEVEL}
                onValueChange={(value) => setProjectChoice(value ?? USER_LEVEL)}
              >
                <SelectTrigger className="w-56" aria-label="Project">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value={USER_LEVEL}>Your instructions only</SelectItem>
                  {environmentProjects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          }
        />
      </SettingsSection>
      {activeEnvironmentId === null ? (
        <p className="px-3 text-sm text-muted-foreground sm:px-4">
          Connect an environment to edit agent instructions.
        </p>
      ) : (
        <InstructionFiles
          key={`${activeEnvironmentId}:${projectId ?? USER_LEVEL}`}
          environmentId={activeEnvironmentId}
          projectId={projectId}
        />
      )}
    </SettingsPageContainer>
  );
}

function InstructionFiles(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | undefined;
}) {
  const listInstructions = useAtomCommand(serverEnvironment.listAgentInstructions, commandOptions);
  const canWrite = useEnvironmentScope(props.environmentId, AuthSettingsWriteScope);
  const [files, setFiles] = useState<ReadonlyArray<AgentInstructionsFile> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { environmentId, projectId } = props;

  const input = projectId === undefined ? {} : { projectId };

  const load = async () => {
    const result = await listInstructions({ environmentId, input });
    if (result._tag === "Success") {
      setFiles(result.value.files);
      setError(null);
      return;
    }
    setError(failureMessage(result));
  };

  // oxlint-disable-next-line moonfold/no-unreasoned-state-sync -- reads the instruction files from the environment when this panel mounts for an environment and project, and ignores the answer after unmount
  useEffect(() => {
    let live = true;
    void listInstructions({
      environmentId,
      input: projectId === undefined ? {} : { projectId },
    }).then((result) => {
      if (!live) return;
      if (result._tag === "Success") {
        setFiles(result.value.files);
        setError(null);
        return;
      }
      setError(failureMessage(result));
    });
    return () => {
      live = false;
    };
  }, [environmentId, listInstructions, projectId]);

  if (error !== null) {
    return (
      <SettingsSection title="Instruction files">
        <SettingsRow
          title="Could not read the instruction files"
          description={error}
          control={
            <Button size="xs" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      </SettingsSection>
    );
  }
  if (files === null) return null;
  return (
    <>
      {files.map((file) => (
        <InstructionFileEditor
          key={file.id}
          environmentId={environmentId}
          projectId={projectId}
          file={file}
          canWrite={canWrite}
          onReload={() => void load()}
        />
      ))}
    </>
  );
}

function InstructionFileEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | undefined;
  readonly file: AgentInstructionsFile;
  readonly canWrite: boolean;
  readonly onReload: () => void;
}) {
  const writeInstructions = useAtomCommand(
    serverEnvironment.writeAgentInstructions,
    commandOptions,
  );
  const { file } = props;
  const [draft, setDraft] = useState(file.contents ?? "");
  const [revision, setRevision] = useState(file.revision);
  const [saved, setSaved] = useState(file.contents ?? "");
  const [saving, setSaving] = useState(false);
  const copy = FILE_COPY[file.id];
  const dirty = draft !== saved;

  const save = async () => {
    setSaving(true);
    const result = await writeInstructions({
      environmentId: props.environmentId,
      input: {
        id: file.id,
        ...(props.projectId === undefined ? {} : { projectId: props.projectId }),
        contents: draft,
        expectedRevision: revision,
      },
    });
    setSaving(false);
    if (result._tag === "Success") {
      setRevision(result.value.revision);
      setSaved(draft);
      toastManager.add({ type: "success", title: `${copy.title} saved` });
      return;
    }
    const message = failureMessage(result);
    if (message !== null) {
      toastManager.add({
        type: "error",
        title: `Could not save ${copy.title}`,
        description: message,
      });
    }
  };

  return (
    <SettingsSection title={copy.title}>
      <SettingsRow
        title={file.path}
        description={
          file.tooLarge
            ? "This file is larger than 512 KB, so edit it in your editor."
            : file.contents === null
              ? `${copy.description} The file does not exist yet; saving creates it.`
              : copy.description
        }
        control={
          file.tooLarge || !props.canWrite ? null : (
            <div className="flex gap-1.5">
              <Button size="xs" variant="ghost" disabled={saving} onClick={props.onReload}>
                Reload
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={!dirty || saving}
                onClick={() => setDraft(saved)}
              >
                Discard
              </Button>
              <Button size="xs" disabled={!dirty || saving} onClick={() => void save()}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          )
        }
      />
      {file.tooLarge ? null : (
        <div className="px-3 pb-3 sm:px-4">
          <Textarea
            aria-label={copy.title}
            value={draft}
            readOnly={!props.canWrite}
            spellCheck={false}
            rows={10}
            placeholder="Write instructions in Markdown."
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
        </div>
      )}
    </SettingsSection>
  );
}
