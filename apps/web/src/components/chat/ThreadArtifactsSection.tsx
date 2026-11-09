import type { EnvironmentId, ThreadId } from "@moonfold/contracts";
import { FileIcon, PaperclipIcon } from "lucide-react";
import { useState } from "react";

import { useRightPanelStore } from "../../rightPanelStore";
import { useThreadVisibleTurnItems } from "../../state/entities";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { THREAD_DETAILS_PANEL_LABEL_CLASS } from "./threadDetailsPanelStyles";
import { artifactLabel, threadArtifacts, type ThreadArtifact } from "./threadArtifacts.logic";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

/** How many artifacts show before "Show all". */
const COLLAPSED_COUNT = 8;

/** Files the thread changed and files attached to it, each opening in the file preview. */
export function ThreadArtifactsSection(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const threadRef = { environmentId: props.environmentId, threadId: props.threadId };
  const items = useThreadVisibleTurnItems(threadRef);
  const artifacts = threadArtifacts(items);
  const [expanded, setExpanded] = useState(false);
  if (artifacts.length === 0) return null;
  const shown = expanded ? artifacts : artifacts.slice(0, COLLAPSED_COUNT);

  const open = (artifact: ThreadArtifact) => {
    const store = useRightPanelStore.getState();
    if (artifact.kind === "attachment") store.openAttachment(threadRef, artifact.attachment);
    else store.openFile(threadRef, artifact.path);
  };

  return (
    <ThreadDetailsSection headingId="thread-details-artifacts-heading" title="Artifacts">
      <ul className="flex flex-col">
        {shown.map((artifact) => {
          const key = artifact.kind === "file" ? `file:${artifact.path}` : artifact.attachment.id;
          const detail =
            artifact.kind === "file"
              ? artifact.deleted
                ? "Deleted"
                : "Changed"
              : artifact.from === "agent"
                ? "From the agent"
                : "Attached";
          const deleted = artifact.kind === "file" && artifact.deleted;
          return (
            <li key={key}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ThreadDetailsControl
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={deleted}
                      onClick={() => open(artifact)}
                    />
                  }
                >
                  {artifact.kind === "file" ? (
                    <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <PaperclipIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span
                    className={`min-w-0 flex-1 truncate text-left ${THREAD_DETAILS_PANEL_LABEL_CLASS}`}
                  >
                    {artifactLabel(artifact)}
                  </span>
                  <span className="shrink-0 text-2xs text-muted-foreground">{detail}</span>
                </TooltipTrigger>
                <TooltipPopup side="left">
                  {artifact.kind === "file" ? artifact.path : artifact.attachment.name}
                </TooltipPopup>
              </Tooltip>
            </li>
          );
        })}
      </ul>
      {artifacts.length > COLLAPSED_COUNT ? (
        <Button
          size="xs"
          variant="ghost-muted"
          className="mt-1"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Show fewer" : `Show all ${artifacts.length}`}
        </Button>
      ) : null}
    </ThreadDetailsSection>
  );
}
