import {
  type EnvironmentId,
  MAX_ORBIT_EVERY_HOURS,
  MAX_ORBIT_RUNS_PER_DAY,
  MIN_ORBIT_EVERY_HOURS,
  ORBIT_LEVELS,
  ORBIT_ROLES,
  type OrbitConfig,
  type OrbitItem,
  type OrbitLevel,
  type OrbitRole,
  type OrbitSnapshot,
  type ProjectId,
} from "@moonfold/contracts";
import { Link } from "@tanstack/react-router";
import { PauseIcon, PlayIcon, SendIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { usePrimaryEnvironment } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { LivingMark } from "../brand/LivingMark";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import {
  backlogItems,
  crewMarkState,
  inboxItems,
  openSignalCount,
  parseLines,
  ROLE_DUTIES,
  ROLE_LABELS,
} from "./orbit.logic";

const LEVEL_LABELS: Record<OrbitLevel, string> = {
  observe: "Observe: read and report",
  propose: "Propose: pull requests and drafts",
  ship: "Ship: merge green, reviewed work",
  publish: "Publish: also post allowed drafts",
};

/** Crew status changes as runs start and finish; the page reads it again on this beat. */
const REFRESH_MS = 30_000;

/**
 * Orbit (D-70): the owner's view of a crew that works on one project. The mission is the prompt;
 * the crew sits down the side with its living-mark state; the inbox holds what needs a look.
 */
export function OrbitPage() {
  const environment = usePrimaryEnvironment();
  const projects = useProjects().filter(
    (project) => environment !== null && project.environmentId === environment.environmentId,
  );
  const [projectId, setProjectId] = useState<ProjectId | null>(null);
  const selected = projectId ?? projects[0]?.id ?? null;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
          <LivingMark size={22} label="" />
          <h1 className="text-base font-medium">Orbit</h1>
          <span className="text-muted-foreground text-sm">
            A crew that keeps working on a project
          </span>
          {projects.length > 0 ? (
            <div className="ms-auto w-full sm:w-56">
              <Select value={selected} onValueChange={(value) => setProjectId(value as ProjectId)}>
                <SelectTrigger size="sm" className="w-full min-w-0" aria-label="Project">
                  <SelectValue>
                    {projects.find((project) => project.id === selected)?.title ?? "Project"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          ) : null}
        </header>
        {environment === null || selected === null ? (
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyMedia>
                <LivingMark size={40} twinkle label="" />
              </EmptyMedia>
              <EmptyTitle>No project yet</EmptyTitle>
              <EmptyDescription>Add a project, then give Orbit a mission for it.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <OrbitProject
            key={`${environment.environmentId}:${selected}`}
            environmentId={environment.environmentId}
            projectId={selected}
          />
        )}
      </div>
    </SidebarInset>
  );
}

function OrbitProject({
  environmentId,
  projectId,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.orbit({ environmentId, input: { projectId } }),
  );
  const update = useAtomCommand(serverEnvironment.updateOrbit, { label: "orbit update" });
  const runRole = useAtomCommand(serverEnvironment.runOrbitRole, { label: "orbit run" });
  const resolve = useAtomCommand(serverEnvironment.resolveOrbitItem, { label: "orbit item" });
  const request = useAtomCommand(serverEnvironment.requestOrbit, { label: "orbit request" });
  const [error, setError] = useState<string | null>(null);
  const snapshot = query.data;

  // oxlint-disable-next-line moonfold/no-unreasoned-state-sync -- crew runs start and finish on the server's schedule; the page reads their status again while it is open
  useEffect(() => {
    const timer = window.setInterval(() => query.refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [query]);

  const act = async (run: () => Promise<{ readonly _tag: string }>) => {
    setError(null);
    const result = await run();
    if (result._tag === "Failure") setError("That did not go through. Try again.");
    query.refresh();
  };
  const save = (input: {
    readonly config?: OrbitConfig;
    readonly mission?: string;
    readonly paused?: boolean;
  }) => act(() => update({ environmentId, input: { projectId, ...input } }));

  if (snapshot === null) {
    return (
      <p className="text-muted-foreground p-6 text-sm" role="status">
        {query.error ?? "Loading Orbit…"}
      </p>
    );
  }
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 p-4 sm:p-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <CrewRail
        snapshot={snapshot}
        onRun={(role) => act(() => runRole({ environmentId, input: { projectId, role } }))}
        onSave={(config) => save({ config })}
      />
      <main className="flex min-w-0 flex-col gap-6">
        {error !== null ? (
          <p role="alert" className="text-destructive-foreground text-sm">
            {error}
          </p>
        ) : null}
        <MissionPrompt
          snapshot={snapshot}
          onSave={(mission) => save({ mission })}
          onToggle={(enabled) => save({ config: { ...snapshot.config, enabled } })}
          onPause={(paused) => save({ paused })}
          onAsk={(text) => act(() => request({ environmentId, input: { projectId, text } }))}
        />
        <Inbox
          environmentId={environmentId}
          items={inboxItems(snapshot.items)}
          onResolve={(item, status) =>
            act(() => resolve({ environmentId, input: { projectId, id: item.id, status } }))
          }
        />
        <Backlog snapshot={snapshot} environmentId={environmentId} />
        <details className="text-sm">
          <summary className="text-muted-foreground cursor-pointer">Activity log</summary>
          <ol className="mt-2 flex flex-col gap-1">
            {snapshot.audit.map((entry) => (
              <li
                key={`${entry.at}:${entry.actor}:${entry.action}:${entry.detail}`}
                className="text-muted-foreground flex gap-2 text-xs"
              >
                <span className="shrink-0 tabular-nums">{formatRelativeTimeLabel(entry.at)}</span>
                <span className="text-foreground">{entry.actor}</span>
                <span>{entry.action}</span>
                <span className="truncate">{entry.detail}</span>
              </li>
            ))}
          </ol>
        </details>
      </main>
    </div>
  );
}

function MissionPrompt({
  snapshot,
  onSave,
  onToggle,
  onPause,
  onAsk,
}: {
  readonly snapshot: OrbitSnapshot;
  readonly onSave: (mission: string) => void;
  readonly onToggle: (enabled: boolean) => void;
  readonly onPause: (paused: boolean) => void;
  readonly onAsk: (text: string) => void;
}) {
  const [mission, setMission] = useState(snapshot.mission);
  const [ask, setAsk] = useState("");
  const changed = mission.trim() !== snapshot.mission.trim();
  return (
    <section className="flex flex-col gap-3" aria-labelledby="orbit-mission">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="orbit-mission" className="text-sm font-medium">
          Mission
        </h2>
        <label className="text-muted-foreground ms-auto flex items-center gap-2 text-sm">
          Orbit is {snapshot.config.enabled ? "on" : "off"}
          <Switch
            aria-label="Turn Orbit on for this project"
            checked={snapshot.config.enabled}
            onCheckedChange={onToggle}
          />
        </label>
        {snapshot.config.enabled ? (
          <Button size="sm" variant="outline" onClick={() => onPause(!snapshot.paused)}>
            {snapshot.paused ? <PlayIcon /> : <PauseIcon />}
            {snapshot.paused ? "Resume" : "Stop all"}
          </Button>
        ) : null}
      </div>
      <Textarea
        aria-label="Mission"
        value={mission}
        rows={5}
        maxLength={8_000}
        placeholder="What this product is, who it is for, and what the crew should work towards. For example: a calm budgeting app for students; make importing bank statements effortless; never add tracking."
        onChange={(event) => setMission(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={!changed} onClick={() => onSave(mission.trim())}>
          Save mission
        </Button>
        <p className="text-muted-foreground text-xs">
          Only you can change the mission. Agents read it but cannot edit it.
        </p>
      </div>
      {snapshot.holdReason !== null ? (
        <p className="border-border bg-muted/40 rounded-md border px-3 py-2 text-sm" role="status">
          {snapshot.holdReason}
        </p>
      ) : (
        <p className="text-muted-foreground text-sm" role="status">
          Running. {snapshot.runsToday} of {snapshot.config.maxRunsPerDay} runs used today.
        </p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (ask.trim() === "") return;
          onAsk(ask.trim());
          setAsk("");
        }}
      >
        <Textarea
          aria-label="Ask the crew"
          value={ask}
          rows={1}
          maxLength={2_000}
          placeholder="Ask the crew for something. It goes to the top of the backlog."
          onChange={(event) => setAsk(event.target.value)}
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Add to the backlog"
          disabled={ask.trim() === ""}
        >
          <SendIcon />
        </Button>
      </form>
    </section>
  );
}

function CrewRail({
  snapshot,
  onRun,
  onSave,
}: {
  readonly snapshot: OrbitSnapshot;
  readonly onRun: (role: OrbitRole) => void;
  readonly onSave: (config: OrbitConfig) => void;
}) {
  const config = snapshot.config;
  const setRole = (role: OrbitRole, patch: Partial<OrbitConfig["roles"][OrbitRole]>) =>
    onSave({ ...config, roles: { ...config.roles, [role]: { ...config.roles[role], ...patch } } });
  return (
    <aside className="flex flex-col gap-5" aria-label="Crew">
      <div className="flex flex-col gap-1.5">
        <label className="text-muted-foreground text-xs" htmlFor="orbit-level">
          Autonomy
        </label>
        <Select
          value={config.level}
          onValueChange={(value) => {
            if ((ORBIT_LEVELS as ReadonlyArray<string>).includes(value as string)) {
              onSave({ ...config, level: value as OrbitLevel });
            }
          }}
        >
          <SelectTrigger size="sm" id="orbit-level" className="w-full min-w-0">
            <SelectValue>{LEVEL_LABELS[config.level]}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {ORBIT_LEVELS.map((level) => (
              <SelectItem key={level} value={level}>
                {LEVEL_LABELS[level]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <ul className="flex flex-col gap-1">
        {ORBIT_ROLES.map((role) => {
          const member = snapshot.crew.find((entry) => entry.role === role)!;
          const roleConfig = config.roles[role];
          return (
            <li key={role} className="border-border rounded-md border p-2.5">
              <div className="flex items-center gap-2">
                <LivingMark state={crewMarkState(member, snapshot)} size={18} />
                <span className="text-sm font-medium">{ROLE_LABELS[role]}</span>
                <Switch
                  className="ms-auto"
                  aria-label={`Run the ${ROLE_LABELS[role]}`}
                  checked={roleConfig.enabled}
                  onCheckedChange={(enabled) => setRole(role, { enabled })}
                />
              </div>
              <p className="text-muted-foreground mt-1 text-xs">{ROLE_DUTIES[role]}</p>
              <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <label className="flex items-center gap-1">
                  Every
                  <input
                    type="number"
                    className="border-border bg-background w-12 rounded border px-1 py-0.5 tabular-nums"
                    min={MIN_ORBIT_EVERY_HOURS}
                    max={MAX_ORBIT_EVERY_HOURS}
                    defaultValue={roleConfig.everyHours}
                    aria-label={`${ROLE_LABELS[role]} runs every so many hours`}
                    onBlur={(event) => {
                      const hours = Math.round(Number(event.target.value));
                      if (
                        hours >= MIN_ORBIT_EVERY_HOURS &&
                        hours <= MAX_ORBIT_EVERY_HOURS &&
                        hours !== roleConfig.everyHours
                      ) {
                        setRole(role, { everyHours: hours });
                      }
                    }}
                  />
                  h
                </label>
                {member.lastRunAt !== null ? (
                  <span>· last {formatRelativeTimeLabel(member.lastRunAt)}</span>
                ) : null}
                <Button
                  size="xs"
                  variant="ghost"
                  className="ms-auto"
                  disabled={!member.active || snapshot.holdReason !== null}
                  onClick={() => onRun(role)}
                >
                  Run now
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <Channels config={config} onSave={onSave} />
      <label className="text-muted-foreground flex items-center gap-2 text-xs">
        Runs per day, at most
        <input
          type="number"
          className="border-border bg-background w-14 rounded border px-1 py-0.5 tabular-nums"
          min={1}
          max={MAX_ORBIT_RUNS_PER_DAY}
          defaultValue={config.maxRunsPerDay}
          aria-label="Runs per day, at most"
          onBlur={(event) => {
            const runs = Math.round(Number(event.target.value));
            if (runs >= 1 && runs <= MAX_ORBIT_RUNS_PER_DAY && runs !== config.maxRunsPerDay) {
              onSave({ ...config, maxRunsPerDay: runs });
            }
          }}
        />
      </label>
    </aside>
  );
}

function Channels({
  config,
  onSave,
}: {
  readonly config: OrbitConfig;
  readonly onSave: (config: OrbitConfig) => void;
}) {
  const channels = config.channels;
  const field = (
    label: string,
    value: ReadonlyArray<string>,
    max: number,
    placeholder: string,
    apply: (lines: ReadonlyArray<string>) => OrbitConfig["channels"],
  ) => (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <Textarea
        rows={2}
        defaultValue={value.join("\n")}
        placeholder={placeholder}
        onBlur={(event) => {
          const lines = parseLines(event.target.value, max);
          if (lines.join("\n") !== value.join("\n")) onSave({ ...config, channels: apply(lines) });
        }}
      />
    </label>
  );
  return (
    <section className="flex flex-col gap-3" aria-label="Channels">
      <h2 className="text-sm font-medium">Where to listen</h2>
      <label className="flex items-center gap-2 text-sm">
        <Switch
          aria-label="Read this repository's GitHub issues"
          checked={channels.github}
          onCheckedChange={(github) => onSave({ ...config, channels: { ...channels, github } })}
        />
        GitHub issues
      </label>
      {field("Hacker News searches, one per line", channels.hackerNews, 10, "my-app", (lines) => ({
        ...channels,
        hackerNews: lines,
      }))}
      {field("Subreddits, one per line", channels.reddit, 10, "budgeting", (lines) => ({
        ...channels,
        reddit: lines.map((line) => line.replace(/^\/?r\//i, "")),
      }))}
      {field("RSS or Atom feeds, one per line", channels.feeds, 20, "https://…", (lines) => ({
        ...channels,
        feeds: lines.filter((line) => /^https:\/\//i.test(line)),
      }))}
    </section>
  );
}

function ItemRow({
  item,
  actions,
}: {
  readonly item: OrbitItem;
  readonly actions?: React.ReactNode;
}) {
  return (
    <li className="border-border rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={item.kind === "question" ? "warning" : "secondary"}>
          {item.kind === "question" ? "Needs you" : item.kind === "draft" ? "Draft" : "Report"}
        </Badge>
        <span className="text-sm font-medium">{item.title}</span>
        <span className="text-muted-foreground ms-auto text-xs">
          {formatRelativeTimeLabel(item.createdAt)}
        </span>
      </div>
      <p className="text-muted-foreground mt-1.5 text-sm whitespace-pre-wrap">{item.body}</p>
      {item.url !== null ? (
        <a
          className="text-primary mt-1 block truncate text-sm underline-offset-2 hover:underline"
          href={item.url}
          target="_blank"
          rel="noreferrer noopener"
        >
          {item.url}
        </a>
      ) : null}
      {actions !== undefined ? <div className="mt-2 flex gap-2">{actions}</div> : null}
    </li>
  );
}

function Inbox({
  environmentId,
  items,
  onResolve,
}: {
  readonly environmentId: EnvironmentId;
  readonly items: ReadonlyArray<OrbitItem>;
  readonly onResolve: (item: OrbitItem, status: "done" | "dismissed") => void;
}) {
  return (
    <section className="flex flex-col gap-2" aria-labelledby="orbit-inbox">
      <h2 id="orbit-inbox" className="text-sm font-medium">
        Inbox{" "}
        {items.length > 0 ? <span className="text-muted-foreground">· {items.length}</span> : null}
      </h2>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing waiting for you.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              actions={
                <>
                  <Button size="xs" variant="outline" onClick={() => onResolve(item, "done")}>
                    {item.kind === "draft" ? "Sent" : "Done"}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => onResolve(item, "dismissed")}>
                    Dismiss
                  </Button>
                  {item.threadId !== null ? (
                    <Link
                      to="/$environmentId/$threadId"
                      params={{ environmentId, threadId: item.threadId }}
                      className="text-primary ms-auto self-center text-xs underline-offset-2 hover:underline"
                    >
                      Open run
                    </Link>
                  ) : null}
                </>
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function Backlog({
  snapshot,
  environmentId,
}: {
  readonly snapshot: OrbitSnapshot;
  readonly environmentId: EnvironmentId;
}) {
  const items = backlogItems(snapshot.items);
  const signals = openSignalCount(snapshot.items);
  return (
    <section className="flex flex-col gap-2" aria-labelledby="orbit-backlog">
      <h2 id="orbit-backlog" className="text-sm font-medium">
        Backlog
        {signals > 0 ? (
          <span className="text-muted-foreground font-normal">
            {" "}
            · {signals} new {signals === 1 ? "signal" : "signals"} waiting for the planner
          </span>
        ) : null}
      </h2>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Empty. The planner fills it from what the scout hears, and your requests go on top.
        </p>
      ) : (
        <ol className="flex flex-col gap-1">
          {items.map((item, index) => (
            <li key={item.id} className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground w-5 shrink-0 text-end tabular-nums">
                {index + 1}
              </span>
              <span className="truncate">{item.title}</span>
              {item.author === "owner" ? <Badge variant="outline">Yours</Badge> : null}
              {item.status === "in_progress" ? (
                <Badge variant="info" className="ms-auto">
                  Building
                </Badge>
              ) : null}
              {item.threadId !== null && item.status === "in_progress" ? (
                <Link
                  to="/$environmentId/$threadId"
                  params={{ environmentId, threadId: item.threadId }}
                  className="text-primary text-xs underline-offset-2 hover:underline"
                >
                  Open
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
