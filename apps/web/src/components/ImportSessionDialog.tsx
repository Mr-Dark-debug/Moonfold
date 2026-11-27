import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@moonfold/client-runtime/environment";
import {
  AgentSessionSource,
  ProviderDriverKind,
  type AgentSessionLookupPreview,
  type AgentSessionSummary,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
} from "@moonfold/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRightIcon,
  BrainIcon,
  DownloadIcon,
  FolderIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  SearchIcon,
  WrenchIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";

import {
  agentSessionImportSession,
  agentSessionList,
  agentSessionLookup,
} from "../state/agentSessions";
import { environmentProjects } from "../state/projects";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams } from "../threadRoutes";
import { formatRelativeTime } from "../timestampFormat";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";
import { Badge } from "./ui/badge";
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
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Spinner } from "./ui/spinner";
import { toastManager } from "./ui/toast";

export interface ImportSessionRequest {
  readonly environmentId: EnvironmentId;
  readonly projectId?: ProjectId | null;
  readonly initialProvider?: AgentSessionSource;
  readonly initialSessionId?: string;
}

const useImportSessionRequest = create<{ request: ImportSessionRequest | null }>(() => ({
  request: null,
}));

/** Opens the "Import chat session" dialog; the host in the root route renders it. */
export function requestImportSession(request: ImportSessionRequest) {
  useImportSessionRequest.setState({ request });
}

export function ImportSessionDialogHost() {
  const request = useImportSessionRequest((state) => state.request);
  return request ? (
    <ImportSessionDialog
      key={`${request.environmentId}:${request.projectId ?? "all"}:${request.initialSessionId ?? ""}`}
      request={request}
      onClose={() => useImportSessionRequest.setState({ request: null })}
    />
  ) : null;
}

const PROVIDER_LABELS: Record<AgentSessionSource, string> = {
  claudeAgent: "Claude Code",
  codex: "Codex",
  antigravity: "Antigravity",
  pi: "Pi",
};

type ProviderFilter = "all" | AgentSessionSource;

const PROVIDER_FILTER_OPTIONS: ReadonlyArray<{
  readonly value: ProviderFilter;
  readonly label: string;
}> = [
  { value: "all", label: "All providers" },
  { value: "claudeAgent", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "antigravity", label: "Antigravity" },
  { value: "pi", label: "Pi" },
];

function formatCountsSummary(counts: {
  readonly messageCount: number;
  readonly toolCallCount: number;
  readonly reasoningCount: number;
}): string {
  const parts: Array<string> = [];
  if (counts.messageCount > 0) {
    parts.push(`${counts.messageCount} ${counts.messageCount === 1 ? "message" : "messages"}`);
  }
  if (counts.toolCallCount > 0) {
    parts.push(
      `${counts.toolCallCount} ${counts.toolCallCount === 1 ? "tool call" : "tool calls"}`,
    );
  }
  if (counts.reasoningCount > 0) {
    parts.push(
      `${counts.reasoningCount} ${counts.reasoningCount === 1 ? "thinking step" : "thinking steps"}`,
    );
  }
  return parts.join(" · ");
}

function shortenPath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  if (segments.length <= 3) return value;
  return `…/${segments.slice(-2).join("/")}`;
}

function ImportSessionDialog({
  request,
  onClose,
}: {
  request: ImportSessionRequest;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const allProjects = useAtomValue(environmentProjects.projectsAtom);
  const envProjects = allProjects.filter(
    (project) => project.environmentId === request.environmentId,
  );

  const [sessionIdInput, setSessionIdInput] = useState(request.initialSessionId ?? "");
  const [lookupProvider, setLookupProvider] = useState<ProviderFilter>(
    request.initialProvider ?? "all",
  );
  const [browseProvider, setBrowseProvider] = useState<ProviderFilter>(
    request.initialProvider ?? "all",
  );
  const [browseQuery, setBrowseQuery] = useState("");
  const [filterByProject, setFilterByProject] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<ProjectId | null>(
    request.projectId ?? envProjects[0]?.id ?? null,
  );
  const [listReloadToken, setListReloadToken] = useState(0);

  const [lookupState, setLookupState] = useState<{
    readonly loading: boolean;
    readonly queriedId: string | null;
    readonly preview: AgentSessionLookupPreview | null;
    readonly error: string | null;
  }>({
    loading: false,
    queriedId: null,
    preview: null,
    error: null,
  });

  const [listState, setListState] = useState<{
    readonly settledKey: string | null;
    readonly sessions: ReadonlyArray<AgentSessionSummary>;
    readonly truncated: boolean;
    readonly error: string | null;
  }>({
    settledKey: null,
    sessions: [],
    truncated: false,
    error: null,
  });

  const [importingKey, setImportingKey] = useState<string | null>(null);

  const runListSessions = useAtomCommand(agentSessionList, {
    label: "list external sessions",
    reportFailure: false,
  });
  const runLookupSession = useAtomCommand(agentSessionLookup, {
    label: "lookup external session",
    reportFailure: false,
  });
  const runImportSession = useAtomCommand(agentSessionImportSession, {
    label: "import external session",
    reportFailure: false,
  });

  const effectiveProjectId =
    selectedProjectId !== null && envProjects.some((project) => project.id === selectedProjectId)
      ? selectedProjectId
      : (envProjects[0]?.id ?? null);

  const trimmedBrowseQuery = browseQuery.trim();
  const listRequestKey = `${request.environmentId}:${browseProvider}:${
    filterByProject ? (effectiveProjectId ?? "") : ""
  }:${trimmedBrowseQuery}:${listReloadToken}`;
  const listLoading = listState.settledKey !== listRequestKey;

  // oxlint-disable-next-line moonfold/no-unreasoned-state-sync -- loads recent external provider sessions from the server whenever filters or reload trigger change
  useEffect(() => {
    let active = true;
    const key = listRequestKey;
    const timer = window.setTimeout(
      () => {
        void runListSessions({
          environmentId: request.environmentId,
          input: {
            ...(browseProvider === "all" ? {} : { provider: browseProvider }),
            ...(filterByProject && effectiveProjectId !== null
              ? { projectId: effectiveProjectId }
              : {}),
            ...(trimmedBrowseQuery.length > 0 ? { query: trimmedBrowseQuery } : {}),
            limit: 60,
          },
        }).then((result) => {
          if (!active) return;
          if (result._tag === "Success") {
            setListState({
              settledKey: key,
              sessions: result.value.sessions,
              truncated: result.value.truncated === true,
              error: null,
            });
          } else {
            setListState({
              settledKey: key,
              sessions: [],
              truncated: false,
              error: "Could not load external sessions from this machine.",
            });
          }
        });
      },
      trimmedBrowseQuery.length > 0 ? 180 : 0,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    browseProvider,
    effectiveProjectId,
    filterByProject,
    listRequestKey,
    request.environmentId,
    runListSessions,
    trimmedBrowseQuery,
  ]);

  const openThread = (threadId: ThreadId) => {
    onClose();
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(request.environmentId, threadId)),
    });
  };

  const handleLookup = async (overrideId?: string, overrideProvider?: ProviderFilter) => {
    const trimmed = (overrideId ?? sessionIdInput).trim();
    const providerChoice = overrideProvider ?? lookupProvider;
    if (trimmed.length === 0) {
      setLookupState({ loading: false, queriedId: null, preview: null, error: null });
      return;
    }
    setLookupState({ loading: true, queriedId: trimmed, preview: null, error: null });
    const result = await runLookupSession({
      environmentId: request.environmentId,
      input: {
        sessionId: trimmed,
        ...(providerChoice === "all" ? {} : { provider: providerChoice }),
      },
    });
    if (result._tag === "Success") {
      const preview = result.value.session;
      setLookupState({
        loading: false,
        queriedId: trimmed,
        preview,
        error: null,
      });
      if (
        preview?.matchedProjectId !== null &&
        preview?.matchedProjectId !== undefined &&
        envProjects.some((project) => project.id === preview.matchedProjectId)
      ) {
        setSelectedProjectId(preview.matchedProjectId);
      }
      return;
    }
    setLookupState({
      loading: false,
      queriedId: trimmed,
      preview: null,
      error: "Could not inspect that session ID. Check the server connection and try again.",
    });
  };

  const handleImport = async (target: {
    readonly sessionId: string;
    readonly provider?: AgentSessionSource;
    readonly matchedProjectId?: ProjectId | null;
    readonly alreadyImportedThreadId?: ThreadId | null;
  }) => {
    if (target.alreadyImportedThreadId) {
      openThread(target.alreadyImportedThreadId);
      return;
    }
    const destinationProjectId =
      effectiveProjectId ?? target.matchedProjectId ?? envProjects[0]?.id ?? null;
    if (destinationProjectId === null) {
      toastManager.add({
        type: "error",
        title: "Add a project first",
        description: "Imported threads belong to a project. Add a project to continue.",
      });
      return;
    }
    const key = `${target.provider ?? "auto"}:${target.sessionId}`;
    setImportingKey(key);
    const result = await runImportSession({
      environmentId: request.environmentId,
      input: {
        sessionId: target.sessionId,
        ...(target.provider === undefined ? {} : { provider: target.provider }),
        projectId: destinationProjectId,
      },
    });
    setImportingKey(null);
    if (result._tag === "Success") {
      const summary = formatCountsSummary(result.value);
      toastManager.add({
        type: "success",
        title: result.value.alreadyImported
          ? `Opened "${result.value.title}"`
          : `Imported "${result.value.title}"`,
        description: result.value.alreadyImported
          ? `This ${PROVIDER_LABELS[result.value.provider]} session was already in Moonfold.`
          : summary.length > 0
            ? `${PROVIDER_LABELS[result.value.provider]} · ${summary}`
            : `Imported from ${PROVIDER_LABELS[result.value.provider]}.`,
      });
      openThread(result.value.threadId);
      return;
    }
    toastManager.add({
      type: "error",
      title: "Could not import session",
      description:
        "Double-check the session ID and make sure the session transcript exists on this machine.",
    });
  };

  const busy = importingKey !== null;
  const trimmedInput = sessionIdInput.trim();

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <span className="inline-flex items-center gap-2">
              <DownloadIcon className="size-4 text-muted-foreground" />
              Import chat session
            </span>
          </DialogTitle>
          <DialogDescription>
            Paste a session ID or pick a recent local conversation from Claude Code, Codex,
            Antigravity, or Pi to import messages, thinking, and tool calls into Moonfold.
          </DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <div className="space-y-4">
            {/* Session ID lookup */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="import-session-id-input"
                  className="text-xs font-medium text-foreground"
                >
                  Import by session ID
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Project</span>
                  {envProjects.length > 0 ? (
                    <Select
                      value={effectiveProjectId ?? ""}
                      onValueChange={(value) => {
                        if (value) setSelectedProjectId(value as ProjectId);
                      }}
                    >
                      <SelectTrigger size="compact" aria-label="Target project">
                        <SelectValue>
                          {envProjects.find((project) => project.id === effectiveProjectId)
                            ?.title ?? "Select project"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        {envProjects.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.title}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  ) : (
                    <Badge variant="warning" size="sm">
                      No projects yet
                    </Badge>
                  )}
                </div>
              </div>

              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleLookup();
                }}
              >
                <div className="min-w-0 flex-1">
                  <Input
                    id="import-session-id-input"
                    font="mono"
                    size="sm"
                    placeholder="Paste session UUID (e.g. 50f6346a-2a6e-4dc7-9121-…)"
                    value={sessionIdInput}
                    onChange={(event) => setSessionIdInput(event.currentTarget.value)}
                    disabled={busy}
                    autoFocus
                  />
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Select
                    value={lookupProvider}
                    onValueChange={(value) => {
                      if (value) setLookupProvider(value as ProviderFilter);
                    }}
                  >
                    <SelectTrigger size="sm" aria-label="Provider">
                      <SelectValue>
                        {lookupProvider === "all" ? "Auto-detect" : PROVIDER_LABELS[lookupProvider]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="all">Auto-detect</SelectItem>
                      {AgentSessionSource.literals.map((source) => (
                        <SelectItem key={source} value={source}>
                          {PROVIDER_LABELS[source]}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    disabled={trimmedInput.length === 0 || lookupState.loading || busy}
                  >
                    {lookupState.loading ? <Spinner className="size-3.5" /> : "Find"}
                  </Button>
                </div>
              </form>

              {/* Lookup preview card */}
              {lookupState.error !== null ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive-foreground">
                  {lookupState.error}
                </div>
              ) : null}

              {!lookupState.loading &&
              lookupState.queriedId !== null &&
              lookupState.preview === null &&
              lookupState.error === null ? (
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                  No session found with ID{" "}
                  <code className="font-mono text-foreground">{lookupState.queriedId}</code>. Check
                  Claude Code (<code className="font-mono">~/.claude/projects</code>), Codex (
                  <code className="font-mono">~/.codex/sessions</code>), or Antigravity (
                  <code className="font-mono">~/.gemini/antigravity</code>).
                </div>
              ) : null}

              {lookupState.preview !== null ? (
                <SessionPreviewCard
                  preview={lookupState.preview}
                  importing={
                    importingKey ===
                    `${lookupState.preview.provider}:${lookupState.preview.sessionId}`
                  }
                  disabled={busy || effectiveProjectId === null}
                  onImport={() => {
                    if (lookupState.preview === null) return;
                    void handleImport({
                      sessionId: lookupState.preview.sessionId,
                      provider: lookupState.preview.provider,
                      matchedProjectId: lookupState.preview.matchedProjectId,
                      alreadyImportedThreadId: lookupState.preview.alreadyImportedThreadId,
                    });
                  }}
                />
              ) : null}
            </div>

            {/* Recent local sessions browser */}
            <div className="space-y-2.5 border-t border-border pt-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">Recent local sessions</span>
                <div className="flex items-center gap-1.5">
                  {effectiveProjectId !== null ? (
                    <Button
                      type="button"
                      size="xs"
                      variant={filterByProject ? "secondary" : "ghost"}
                      onClick={() => setFilterByProject((value) => !value)}
                    >
                      <FolderIcon className="size-3" />
                      {filterByProject ? "This project only" : "All folders"}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Refresh sessions"
                    disabled={listLoading}
                    onClick={() => setListReloadToken((count) => count + 1)}
                  >
                    <RefreshCwIcon className="size-3.5" />
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {PROVIDER_FILTER_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    size="xs"
                    variant={browseProvider === option.value ? "secondary" : "outline"}
                    onClick={() => setBrowseProvider(option.value)}
                  >
                    {option.value !== "all" ? (
                      <ProviderInstanceIcon
                        driverKind={ProviderDriverKind.make(option.value)}
                        displayName={option.label}
                        iconClassName="size-3"
                      />
                    ) : null}
                    {option.label}
                  </Button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <Input
                    size="compact"
                    type="search"
                    placeholder="Filter by title, folder, model, or session ID…"
                    value={browseQuery}
                    onChange={(event) => setBrowseQuery(event.currentTarget.value)}
                  />
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
                {listLoading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                    <Spinner className="size-3.5" />
                    Scanning Claude Code, Codex, Antigravity, and Pi sessions…
                  </div>
                ) : listState.error !== null ? (
                  <div className="px-3 py-6 text-center text-xs text-destructive-foreground">
                    {listState.error}
                  </div>
                ) : listState.sessions.length === 0 ? (
                  <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                    No matching local sessions found.
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {listState.sessions.map((session) => {
                      const rowKey = `${session.provider}:${session.sessionId}`;
                      const isRowImporting = importingKey === rowKey;
                      const relative = formatRelativeTime(session.updatedAt);
                      const age =
                        relative === null || relative.suffix === null ? "now" : relative.value;
                      return (
                        <li
                          key={rowKey}
                          className="flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-muted/40"
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 text-left"
                            disabled={busy}
                            onClick={() => {
                              setSessionIdInput(session.sessionId);
                              setLookupProvider(session.provider);
                              void handleLookup(session.sessionId, session.provider);
                            }}
                          >
                            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                              <ProviderInstanceIcon
                                driverKind={ProviderDriverKind.make(session.provider)}
                                displayName={PROVIDER_LABELS[session.provider]}
                                iconClassName="size-3.5"
                              />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-sm font-medium text-foreground">
                                  {session.title}
                                </span>
                                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                  {age}
                                </span>
                              </span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                                <span>{PROVIDER_LABELS[session.provider]}</span>
                                <code className="font-mono text-2xs">
                                  {session.sessionId.slice(0, 8)}
                                </code>
                                {session.cwd ? (
                                  <span className="truncate">{shortenPath(session.cwd)}</span>
                                ) : null}
                              </span>
                            </span>
                          </button>
                          <div className="shrink-0">
                            {session.alreadyImportedThreadId !== null ? (
                              <Button
                                type="button"
                                size="xs"
                                variant="outline"
                                disabled={busy}
                                onClick={() => openThread(session.alreadyImportedThreadId!)}
                              >
                                Open
                                <ArrowUpRightIcon className="size-3" />
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                size="xs"
                                variant="secondary"
                                disabled={busy || effectiveProjectId === null}
                                onClick={() => {
                                  void handleImport({
                                    sessionId: session.sessionId,
                                    provider: session.provider,
                                    matchedProjectId: session.matchedProjectId,
                                  });
                                }}
                              >
                                {isRowImporting ? <Spinner className="size-3" /> : "Import"}
                              </Button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </DialogPanel>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Close
          </Button>
          {lookupState.preview !== null ? (
            <Button
              type="button"
              disabled={busy || effectiveProjectId === null}
              onClick={() => {
                if (lookupState.preview === null) return;
                void handleImport({
                  sessionId: lookupState.preview.sessionId,
                  provider: lookupState.preview.provider,
                  matchedProjectId: lookupState.preview.matchedProjectId,
                  alreadyImportedThreadId: lookupState.preview.alreadyImportedThreadId,
                });
              }}
            >
              {busy ? (
                <Spinner className="size-3.5" />
              ) : lookupState.preview.alreadyImportedThreadId !== null ? (
                "Open imported thread"
              ) : (
                "Import full session"
              )}
            </Button>
          ) : trimmedInput.length > 0 ? (
            <Button
              type="button"
              disabled={busy || effectiveProjectId === null}
              onClick={() => {
                void handleImport({
                  sessionId: trimmedInput,
                  ...(lookupProvider === "all" ? {} : { provider: lookupProvider }),
                });
              }}
            >
              {busy ? <Spinner className="size-3.5" /> : "Import by ID"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function SessionPreviewCard({
  preview,
  importing,
  disabled,
  onImport,
}: {
  readonly preview: AgentSessionLookupPreview;
  readonly importing: boolean;
  readonly disabled: boolean;
  readonly onImport: () => void;
}) {
  const relative = formatRelativeTime(preview.updatedAt);
  const age = relative === null || relative.suffix === null ? "now" : relative.value;
  return (
    <div className="space-y-2.5 rounded-lg border border-border bg-muted/25 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-background">
            <ProviderInstanceIcon
              driverKind={ProviderDriverKind.make(preview.provider)}
              displayName={PROVIDER_LABELS[preview.provider]}
              iconClassName="size-3.5"
            />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-medium text-foreground">{preview.title}</span>
              <Badge variant="secondary" size="sm">
                {PROVIDER_LABELS[preview.provider]}
              </Badge>
              {preview.alreadyImportedThreadId !== null ? (
                <Badge variant="success" size="sm">
                  Imported
                </Badge>
              ) : null}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <code className="font-mono text-2xs">{preview.sessionId}</code>
              <span>·</span>
              <span>{age}</span>
              {preview.model ? (
                <>
                  <span>·</span>
                  <span className="font-mono text-2xs">{preview.model}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>
        <Button type="button" size="xs" disabled={disabled} onClick={onImport}>
          {importing ? (
            <Spinner className="size-3" />
          ) : preview.alreadyImportedThreadId !== null ? (
            <>
              Open
              <ArrowUpRightIcon className="size-3" />
            </>
          ) : (
            "Import"
          )}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" size="sm">
          <MessageSquareIcon className="size-3" />
          {preview.messageCount} {preview.messageCount === 1 ? "message" : "messages"}
        </Badge>
        {preview.toolCallCount > 0 ? (
          <Badge variant="outline" size="sm">
            <WrenchIcon className="size-3" />
            {preview.toolCallCount} {preview.toolCallCount === 1 ? "tool call" : "tool calls"}
          </Badge>
        ) : null}
        {preview.reasoningCount > 0 ? (
          <Badge variant="outline" size="sm">
            <BrainIcon className="size-3" />
            {preview.reasoningCount} thinking
          </Badge>
        ) : null}
        {preview.cwd ? (
          <Badge variant="outline" size="sm" title={preview.cwd}>
            <FolderIcon className="size-3" />
            {shortenPath(preview.cwd)}
          </Badge>
        ) : null}
      </div>

      {preview.firstUserPrompt ? (
        <p className="line-clamp-2 rounded-md bg-background/70 px-2.5 py-1.5 text-xs text-muted-foreground">
          {preview.firstUserPrompt}
        </p>
      ) : null}
    </div>
  );
}
