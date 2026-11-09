import {
  AuthProvidersManageScope,
  type EnvironmentId,
  type ProjectId,
  type ProviderAccountUsage,
  type ProviderAgentImportItem,
  type ProviderHookList,
  type ProviderInstanceId,
  type ProviderMcpServer,
  type ProviderSkillEntry,
  type ProviderSkillList,
} from "@moonfold/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@moonfold/client-runtime/state/runtime";
import { isLoopbackHost } from "@moonfold/shared/preview";
import { useEffect, useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { useEnvironmentHttpBaseUrl } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { groupHooksBySource } from "./CodexNativeConfigSections.logic";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { SettingsRow } from "./settingsLayout";

interface NativeConfigProject {
  readonly id: ProjectId;
  readonly title: string;
}

interface SectionProps {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly readOnly: boolean;
}

const USER_SCOPE = "user";
const commandOptions = { reportFailure: false, reportDefect: false } as const;

function failureMessage(result: AtomCommandResult<unknown, unknown>): string | null {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "Codex did not answer.";
}

function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>) {
  const description = failureMessage(result);
  if (description !== null) toastManager.add({ type: "error", title, description });
}

function formatCount(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Codex's own MCP servers, skills, hooks and imports, read through the
 * instance's Codex CLI. Each section loads when first opened.
 */
export function CodexNativeConfigSections(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly projects: ReadonlyArray<NativeConfigProject>;
  readonly readOnly: boolean;
}) {
  const canManage = useEnvironmentScope(props.environmentId, AuthProvidersManageScope);
  const [scope, setScope] = useState<string>(USER_SCOPE);
  if (!canManage) return null;
  const projectId =
    scope === USER_SCOPE ? undefined : props.projects.find((project) => project.id === scope)?.id;
  const sectionProps = {
    environmentId: props.environmentId,
    instanceId: props.instanceId,
    readOnly: props.readOnly,
  };
  return (
    <div className="space-y-3">
      <McpServersSection {...sectionProps} />
      {props.projects.length > 0 ? (
        <SettingsRow
          title="Project for skills, hooks and imports"
          description="User-level configuration always applies. A project adds its own."
          control={
            <Select value={scope} onValueChange={(value) => setScope(value ?? USER_SCOPE)}>
              <SelectTrigger className="w-56" aria-label="Project for skills, hooks and imports">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value={USER_SCOPE}>User level only</SelectItem>
                {props.projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      ) : null}
      <SkillsSection key={`skills:${scope}`} {...sectionProps} projectId={projectId} />
      <HooksSection key={`hooks:${scope}`} {...sectionProps} projectId={projectId} />
      <AgentImportSection key={`import:${scope}`} {...sectionProps} projectId={projectId} />
      <AccountUsageSection {...sectionProps} />
    </div>
  );
}

function mcpStatus(server: ProviderMcpServer) {
  if (server.auth === "notLoggedIn") return <Badge variant="warning">Sign-in needed</Badge>;
  if (server.error !== null) return <Badge variant="error">Error</Badge>;
  if (server.auth === "oAuth") return <Badge variant="success">Signed in</Badge>;
  if (server.state === "connected") return <Badge variant="success">Connected</Badge>;
  return null;
}

function McpServersSection(props: SectionProps) {
  const listServers = useAtomCommand(serverEnvironment.listProviderMcpServers, commandOptions);
  const reloadServers = useAtomCommand(serverEnvironment.reloadProviderMcpServers, commandOptions);
  const [servers, setServers] = useState<ReadonlyArray<ProviderMcpServer> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const target = { instanceId: props.instanceId };

  const load = async () => {
    setLoading(true);
    const result = await listServers({ environmentId: props.environmentId, input: target });
    setLoading(false);
    if (result._tag === "Success") {
      setServers(result.value.servers);
      setError(null);
      return;
    }
    setError(failureMessage(result));
  };

  const reload = async () => {
    setLoading(true);
    const result = await reloadServers({ environmentId: props.environmentId, input: target });
    setLoading(false);
    if (result._tag === "Failure") return reportFailure("Could not reload MCP servers", result);
    await load();
  };

  return (
    <FoldedSettingsSection
      id={`codex-mcp-${props.instanceId}`}
      title="MCP servers"
      summary={servers === null ? null : formatCount(servers.length, "server", "servers")}
      onOpenChange={(open) => {
        if (open && servers === null && !loading) void load();
      }}
    >
      <SettingsRow
        title="Servers Codex connects to"
        description="Configured in Codex's config.toml and its plugins. Reload after editing the file."
        control={
          <div className="flex gap-1.5">
            <Button size="xs" variant="outline" disabled={loading} onClick={() => void load()}>
              Refresh
            </Button>
            {!props.readOnly ? (
              <Button size="xs" variant="outline" disabled={loading} onClick={() => void reload()}>
                Reload config
              </Button>
            ) : null}
          </div>
        }
      />
      {error !== null ? <SettingsRow title="Could not list servers" description={error} /> : null}
      {servers !== null && servers.length === 0 ? (
        <SettingsRow title="No MCP servers" description="Codex has no MCP servers configured." />
      ) : null}
      {servers?.map((server) => (
        <SettingsRow
          key={server.name}
          title={
            <span className="flex items-center gap-2">
              {server.name}
              {mcpStatus(server)}
            </span>
          }
          description={
            <>
              {[
                server.origin ?? "Local command",
                server.pluginId ? `from ${server.pluginId}` : null,
                formatCount(server.toolNames.length, "tool", "tools"),
              ]
                .filter(Boolean)
                .join(" · ")}
              {server.error !== null ? (
                <span className="block text-destructive-foreground">{server.error}</span>
              ) : null}
            </>
          }
          control={
            server.auth === "notLoggedIn" && !props.readOnly ? (
              signingIn === server.name ? (
                <McpServerSignIn
                  environmentId={props.environmentId}
                  instanceId={props.instanceId}
                  name={server.name}
                  onDone={(success) => {
                    setSigningIn(null);
                    if (success) void load();
                  }}
                />
              ) : (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={signingIn !== null}
                  onClick={() => setSigningIn(server.name)}
                >
                  Sign in
                </Button>
              )
            ) : null
          }
        />
      ))}
    </FoldedSettingsSection>
  );
}

/** Runs one sign-in: shows the page to open, then reports how it ended. */
function McpServerSignIn(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly name: string;
  readonly onDone: (success: boolean) => void;
}) {
  const [login] = useState(() => ({
    environmentId: props.environmentId,
    input: { instanceId: props.instanceId, name: props.name },
  }));
  const event = useEnvironmentQuery(serverEnvironment.mcpServerLoginState(login));
  const httpBaseUrl = useEnvironmentHttpBaseUrl(props.environmentId);
  const remote = httpBaseUrl !== null && !isLoopbackHost(new URL(httpBaseUrl).hostname);
  const url = event.data?.type === "authorizationUrl" ? event.data.url : null;
  const completed = event.data?.type === "completed" ? event.data : null;
  const failed = event.error !== null && event.error !== undefined;
  const { onDone, name } = props;

  // The desktop app can open the browser itself; a web page needs the user's click.
  // oxlint-disable-next-line moonfold/no-unreasoned-state-sync -- asks the desktop shell to open the sign-in page once the login stream reports its URL
  useEffect(() => {
    if (url !== null && window.desktopBridge && !remote) {
      void ensureLocalApi().shell.openExternal(url);
    }
  }, [url, remote]);

  // oxlint-disable-next-line moonfold/no-unreasoned-state-sync -- shows the sign-in result toast once the login stream ends and tells the parent that it finished
  useEffect(() => {
    if (completed === null && !failed) return;
    const success = completed?.success === true;
    toastManager.add(
      success
        ? { type: "success", title: `Signed in to ${name}` }
        : {
            type: "error",
            title: `Could not sign in to ${name}`,
            description: completed?.error ?? "The sign-in did not start.",
          },
    );
    onDone(success);
  }, [completed, failed, name, onDone]);

  if (url === null) {
    return (
      <Button size="xs" variant="outline" disabled>
        Starting…
      </Button>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="xs"
        variant="outline"
        onClick={() => void ensureLocalApi().shell.openExternal(url)}
      >
        Open sign-in page
      </Button>
      {remote ? (
        <span className="max-w-56 text-right text-xs text-muted-foreground">
          Finish in a browser on the computer running this environment.
        </span>
      ) : null}
    </div>
  );
}

function SkillsSection(props: SectionProps & { readonly projectId: ProjectId | undefined }) {
  const listSkills = useAtomCommand(serverEnvironment.listProviderSkills, commandOptions);
  const setEnabled = useAtomCommand(serverEnvironment.setProviderSkillEnabled, commandOptions);
  const readSkill = useAtomCommand(serverEnvironment.readProviderSkill, commandOptions);
  const [list, setList] = useState<ProviderSkillList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{
    skill: ProviderSkillEntry;
    contents: string;
    truncated: boolean;
  } | null>(null);
  const input = {
    instanceId: props.instanceId,
    ...(props.projectId === undefined ? {} : { projectId: props.projectId }),
  };

  const load = async () => {
    setLoading(true);
    const result = await listSkills({ environmentId: props.environmentId, input });
    setLoading(false);
    if (result._tag === "Success") {
      setList(result.value);
      setError(null);
      return;
    }
    setError(failureMessage(result));
  };

  const toggle = async (skill: ProviderSkillEntry, enabled: boolean) => {
    setPendingPath(skill.path);
    const result = await setEnabled({
      environmentId: props.environmentId,
      input: { instanceId: props.instanceId, path: skill.path, enabled },
    });
    setPendingPath(null);
    if (result._tag === "Failure") return reportFailure(`Could not change ${skill.name}`, result);
    if (result.value.enabled !== enabled) {
      toastManager.add({
        type: "warning",
        title: `${skill.name} stays ${result.value.enabled ? "on" : "off"}`,
        description: "Codex configuration at another level decides this skill.",
      });
    }
    setList((current) =>
      current === null
        ? current
        : {
            ...current,
            skills: current.skills.map((candidate) =>
              candidate.path === skill.path
                ? { ...candidate, enabled: result.value.enabled }
                : candidate,
            ),
          },
    );
  };

  const view = async (skill: ProviderSkillEntry) => {
    const result = await readSkill({
      environmentId: props.environmentId,
      input: { ...input, path: skill.path },
    });
    if (result._tag === "Failure") return reportFailure(`Could not open ${skill.name}`, result);
    setViewing({ skill, ...result.value });
  };

  const enabledCount = list?.skills.filter((skill) => skill.enabled).length ?? 0;
  return (
    <FoldedSettingsSection
      id={`codex-skills-${props.instanceId}`}
      title="Skills"
      summary={list === null ? null : `${enabledCount} of ${list.skills.length} on`}
      onOpenChange={(open) => {
        if (open && list === null && !loading) void load();
      }}
    >
      <SettingsRow
        title="Skills Codex can use"
        description="Turning a skill off keeps it installed; Codex stops offering it."
        control={
          <Button size="xs" variant="outline" disabled={loading} onClick={() => void load()}>
            Refresh
          </Button>
        }
      />
      {error !== null ? <SettingsRow title="Could not list skills" description={error} /> : null}
      {list?.errors.map((entry) => (
        <SettingsRow
          key={entry.path}
          title="Skill not loaded"
          description={`${entry.path}: ${entry.message}`}
        />
      ))}
      {list?.skills.map((skill) => (
        <SettingsRow
          key={skill.path}
          title={
            <span className="flex items-center gap-2">
              {skill.displayName ?? skill.name}
              <Badge variant="outline">{skill.scope}</Badge>
            </span>
          }
          description={skill.description}
          control={
            <div className="flex items-center gap-2">
              <Button size="xs" variant="ghost" onClick={() => void view(skill)}>
                View
              </Button>
              <Switch
                aria-label={`Use ${skill.name}`}
                checked={skill.enabled}
                disabled={props.readOnly || pendingPath !== null}
                onCheckedChange={(checked) => void toggle(skill, checked)}
              />
            </div>
          }
        />
      ))}
      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogPopup className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewing?.skill.displayName ?? viewing?.skill.name}</DialogTitle>
            <DialogDescription>{viewing?.skill.path}</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap text-xs">
              {viewing?.contents}
              {viewing?.truncated ? "\n\n[Shortened: the file is longer than 256 KB.]" : ""}
            </pre>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </FoldedSettingsSection>
  );
}

function HooksSection(props: SectionProps & { readonly projectId: ProjectId | undefined }) {
  const listHooks = useAtomCommand(serverEnvironment.listProviderHooks, commandOptions);
  const [list, setList] = useState<ProviderHookList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const result = await listHooks({
      environmentId: props.environmentId,
      input: {
        instanceId: props.instanceId,
        ...(props.projectId === undefined ? {} : { projectId: props.projectId }),
      },
    });
    setLoading(false);
    if (result._tag === "Success") {
      setList(result.value);
      setError(null);
      return;
    }
    setError(failureMessage(result));
  };

  return (
    <FoldedSettingsSection
      id={`codex-hooks-${props.instanceId}`}
      title="Hooks"
      summary={list === null ? null : formatCount(list.hooks.length, "hook", "hooks")}
      onOpenChange={(open) => {
        if (open && list === null && !loading) void load();
      }}
    >
      <SettingsRow
        title="Commands Codex runs on its own events"
        description="Read only here. Edit them in Codex's hooks configuration."
        control={
          <Button size="xs" variant="outline" disabled={loading} onClick={() => void load()}>
            Refresh
          </Button>
        }
      />
      {error !== null ? <SettingsRow title="Could not list hooks" description={error} /> : null}
      {list !== null && list.hooks.length === 0 ? (
        <SettingsRow title="No hooks" description="Codex has no hooks configured for this scope." />
      ) : null}
      {groupHooksBySource(list?.hooks ?? []).map(([group, hooks]) => (
        <div key={group}>
          <p className="px-3 pt-3 text-xs font-medium text-muted-foreground sm:px-4">{group}</p>
          {hooks.map((hook) => (
            <SettingsRow
              key={hook.key}
              title={
                <span className="flex items-center gap-2">
                  {hook.event}
                  {!hook.enabled ? <Badge variant="outline">Off</Badge> : null}
                  {hookTrustBadge(hook.trust)}
                </span>
              }
              description={[
                hook.target ?? hook.handler,
                hook.matcher ? `when ${hook.matcher}` : null,
                hook.sourcePath,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          ))}
        </div>
      ))}
      {[
        ...(list?.warnings ?? []),
        ...(list?.errors.map((entry) => `${entry.path}: ${entry.message}`) ?? []),
      ].map((message) => (
        <SettingsRow key={message} title="Hook configuration problem" description={message} />
      ))}
    </FoldedSettingsSection>
  );
}

function hookTrustBadge(trust: string) {
  switch (trust) {
    case "trusted":
      return null;
    case "managed":
      return <Badge variant="info">Managed</Badge>;
    case "modified":
      return <Badge variant="warning">Changed since trusted</Badge>;
    case "untrusted":
      return <Badge variant="warning">Not trusted</Badge>;
    default:
      return <Badge variant="outline">{trust}</Badge>;
  }
}

function AgentImportSection(props: SectionProps & { readonly projectId: ProjectId | undefined }) {
  const detect = useAtomCommand(serverEnvironment.detectProviderAgentImports, commandOptions);
  const runImport = useAtomCommand(serverEnvironment.runProviderAgentImport, commandOptions);
  const [items, setItems] = useState<ReadonlyArray<ProviderAgentImportItem> | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<"detect" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scope = props.projectId === undefined ? {} : { projectId: props.projectId };

  const load = async () => {
    setBusy("detect");
    const result = await detect({
      environmentId: props.environmentId,
      input: { instanceId: props.instanceId, ...scope },
    });
    setBusy(null);
    if (result._tag === "Success") {
      setItems(result.value.items);
      setSelected(new Set());
      setError(null);
      return;
    }
    setError(failureMessage(result));
  };

  const importSelected = async () => {
    setBusy("import");
    const result = await runImport({
      environmentId: props.environmentId,
      input: { instanceId: props.instanceId, ...scope, itemIds: [...selected] },
    });
    setBusy(null);
    if (result._tag === "Failure") return reportFailure("Import failed", result);
    const imported = result.value.results.reduce((total, entry) => total + entry.imported, 0);
    const failed = result.value.results.reduce((total, entry) => total + entry.failed, 0);
    toastManager.add({
      type: failed > 0 ? "warning" : "success",
      title: `Imported ${formatCount(imported, "item", "items")}`,
      ...(failed > 0
        ? {
            description: result.value.results.flatMap((entry) => entry.errors).join("\n"),
          }
        : {}),
    });
    await load();
  };

  return (
    <FoldedSettingsSection
      id={`codex-import-${props.instanceId}`}
      title="Import from other agents"
      summary={items === null ? null : formatCount(items.length, "item found", "items found")}
      onOpenChange={(open) => {
        if (open && items === null && busy === null) void load();
      }}
    >
      <SettingsRow
        title="Bring skills, MCP servers and sessions into Codex"
        description="Codex looks for configuration from other coding agents on this computer and copies what you pick."
        control={
          <div className="flex gap-1.5">
            <Button
              size="xs"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void load()}
            >
              Look again
            </Button>
            {!props.readOnly ? (
              <Button
                size="xs"
                disabled={busy !== null || selected.size === 0}
                onClick={() => void importSelected()}
              >
                {busy === "import" ? "Importing…" : "Import selected"}
              </Button>
            ) : null}
          </div>
        }
      />
      {error !== null ? (
        <SettingsRow title="Could not look for imports" description={error} />
      ) : null}
      {items !== null && items.length === 0 ? (
        <SettingsRow
          title="Nothing to import"
          description="No other agent configuration was found."
        />
      ) : null}
      {items?.map((item) => (
        <SettingsRow
          key={item.id}
          title={item.description}
          description={
            item.entries.length === 0
              ? null
              : `${item.entries.slice(0, 5).join(", ")}${item.entries.length > 5 ? ` and ${item.entries.length - 5} more` : ""}`
          }
          control={
            <Checkbox
              aria-label={`Import: ${item.description}`}
              checked={selected.has(item.id)}
              disabled={props.readOnly || busy !== null}
              onCheckedChange={(checked) =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (checked) next.add(item.id);
                  else next.delete(item.id);
                  return next;
                })
              }
            />
          }
        />
      ))}
    </FoldedSettingsSection>
  );
}

const tokenFormat = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

function AccountUsageSection(props: SectionProps) {
  const readUsage = useAtomCommand(serverEnvironment.readProviderAccountUsage, commandOptions);
  const [usage, setUsage] = useState<ProviderAccountUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const result = await readUsage({
      environmentId: props.environmentId,
      input: { instanceId: props.instanceId },
    });
    setLoading(false);
    if (result._tag === "Success") {
      setUsage(result.value);
      setError(null);
      return;
    }
    setError(failureMessage(result));
  };

  const recent = usage?.days.slice(-30) ?? [];
  const peak = Math.max(1, ...recent.map((day) => day.tokens));
  const figure = (value: number | null) =>
    value === null ? "Not reported" : tokenFormat.format(value);
  return (
    <FoldedSettingsSection
      id={`codex-account-usage-${props.instanceId}`}
      title="Account usage"
      summary={
        usage?.lifetimeTokens == null
          ? null
          : `${tokenFormat.format(usage.lifetimeTokens)} tokens in total`
      }
      onOpenChange={(open) => {
        if (open && usage === null && !loading) void load();
      }}
    >
      <SettingsRow
        title="Tokens this Codex account has used"
        description="Reported by OpenAI for the signed-in account, across every device it is used on."
        control={
          <Button size="xs" variant="outline" disabled={loading} onClick={() => void load()}>
            Refresh
          </Button>
        }
      />
      {error !== null ? <SettingsRow title="Could not read usage" description={error} /> : null}
      {usage !== null ? (
        <SettingsRow
          title="Totals"
          description={[
            `Lifetime ${figure(usage.lifetimeTokens)}`,
            `busiest day ${figure(usage.peakDailyTokens)}`,
            usage.currentStreakDays === null ? null : `${usage.currentStreakDays}-day streak`,
            usage.longestStreakDays === null ? null : `longest ${usage.longestStreakDays} days`,
            usage.longestTurnSeconds === null
              ? null
              : `longest turn ${Math.round(usage.longestTurnSeconds / 60)} min`,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
      ) : null}
      {recent.length > 0 ? (
        <SettingsRow
          title="Recent days with usage"
          description={`${recent[0]!.date} to ${recent.at(-1)!.date}`}
        >
          <div
            role="img"
            aria-label={`Tokens per day: ${recent.map((day) => `${day.date} ${tokenFormat.format(day.tokens)}`).join(", ")}`}
            className="flex h-16 items-end gap-0.5 px-3 pb-3 sm:px-4"
          >
            {recent.map((day) => (
              <div
                key={day.date}
                className="min-w-0 flex-1 rounded-sm bg-primary/60"
                style={{ height: `${Math.max(4, (day.tokens / peak) * 100)}%` }}
              />
            ))}
          </div>
        </SettingsRow>
      ) : null}
    </FoldedSettingsSection>
  );
}
