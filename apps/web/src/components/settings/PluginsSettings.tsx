import { useAtomValue } from "@effect/atom-react";
import {
  MoreHorizontalIcon,
  PlusIcon,
  PuzzleIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import type { EnvironmentId, InstalledPlugin, PluginSource } from "@moonfold/contracts";
import { resolveEnvironmentMachineKind } from "@moonfold/contracts";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@moonfold/client-runtime/state/runtime";

import { requestConfirmDialog } from "../../confirmDialog";
import type { EnvironmentPresentation } from "../../state/environments";
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
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { mcpServerEnvironment, mcpServerSummary, pluginSourceLabel } from "./pluginsSettings.logic";
import { SkillKindGlyph } from "../brand/BrandGlyph";

const FORMAT_LABELS: Record<InstalledPlugin["formats"][number], string> = {
  skills: "Skills folder",
  codex: "Codex plugin",
  claude: "Claude Code plugin",
};

function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag !== "Failure") return;
  if (isAtomCommandInterrupted(result)) return;
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: String(squashAtomCommandFailure(result)),
    }),
  );
}

/** Settings → Plugins: install bundles of skills and MCP servers and turn them on for agents. */
export function PluginsSettings() {
  const { scope, environments, connectedEnvironments, environment } = useSettingsScope();
  const defaultEnvironment = environment ?? connectedEnvironments[0];
  const [installing, setInstalling] = useState<EnvironmentId | null>(null);
  const canInstall = useAtomValue(
    serverEnvironment.installPlugin.permissionAtom(defaultEnvironment?.environmentId ?? null),
  );
  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Plugins"
        variant="plain"
        headerAction={
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={!defaultEnvironment || !canInstall}
            onClick={() => defaultEnvironment && setInstalling(defaultEnvironment.environmentId)}
          >
            <PlusIcon className="size-3" />
            Add plugin
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">
          A plugin is a folder of skills and optional MCP servers. Enabled plugins reach new Codex
          and Claude Code turns; other providers do not load them yet.
        </p>
        {scope.kind === "unavailable" ? (
          <SettingsSection title="Unavailable selection">
            <SettingsRow title={scope.message} />
          </SettingsSection>
        ) : environments.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PuzzleIcon />
              </EmptyMedia>
              <EmptyTitle>No environments available</EmptyTitle>
              <EmptyDescription>Connect an environment to manage its plugins.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="space-y-8">
            {environments.map((entry) => (
              <PluginEnvironmentSection
                key={entry.environmentId}
                environment={entry}
                showEnvironmentHeading={environments.length > 1}
                onAdd={() => setInstalling(entry.environmentId)}
              />
            ))}
          </div>
        )}
      </SettingsSection>
      {installing ? (
        <InstallPluginDialog environmentId={installing} onClose={() => setInstalling(null)} />
      ) : null}
    </SettingsPageContainer>
  );
}

function PluginEnvironmentSection({
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
  const canManage = useAtomValue(serverEnvironment.installPlugin.permissionAtom(environmentId));
  const pluginsQuery = useEnvironmentQuery(
    connected && canManage ? serverEnvironment.plugins({ environmentId, input: {} }) : null,
  );
  const plugins = pluginsQuery.data?.plugins ?? null;
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
        showEnvironmentHeading && canManage && connected ? (
          <Button
            size="xs"
            variant="ghost-muted"
            aria-label={`Add a plugin to ${environment.label}`}
            onClick={onAdd}
          >
            <PlusIcon className="size-3" />
            Add
          </Button>
        ) : undefined
      }
    >
      {!connected ? (
        <SettingsRow
          title="Environment disconnected"
          description={`Reconnect ${environment.label} to manage its plugins.`}
        />
      ) : !canManage ? (
        <SettingsRow
          title="Provider management access needed"
          description="Plugins run programs on this machine, so managing them needs provider management access."
        />
      ) : pluginsQuery.error ? (
        <SettingsRow title="Could not load plugins" description={pluginsQuery.error} />
      ) : plugins === null ? (
        <SettingsRow title="Loading plugins…" role="status" />
      ) : plugins.length === 0 ? (
        <SettingsRow
          title="No plugins installed"
          description="Add one from a git repository or a folder on this machine."
        />
      ) : (
        plugins.map((plugin) => (
          <PluginRow
            key={plugin.id}
            environmentId={environmentId}
            plugin={plugin}
            onChanged={pluginsQuery.refresh}
          />
        ))
      )}
      {pluginsQuery.data ? (
        <p className="px-4 py-2 text-xs text-muted-foreground">
          Installed in {pluginsQuery.data.directory}
        </p>
      ) : null}
    </SettingsSection>
  );
}

function PluginRow({
  environmentId,
  plugin,
  onChanged,
}: {
  readonly environmentId: EnvironmentId;
  readonly plugin: InstalledPlugin;
  readonly onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const setEnabled = useAtomCommand(serverEnvironment.setPluginEnabled, {
    label: "plugin enabled",
  });
  const update = useAtomCommand(serverEnvironment.updatePlugin, { label: "plugin update" });
  const remove = useAtomCommand(serverEnvironment.removePlugin, { label: "plugin remove" });

  const toggle = async () => {
    if (busy) return;
    if (!plugin.enabled && plugin.mcpServers.length > 0) {
      const message = `Enable ${plugin.name}?\nAgents can start these programs on this machine:\n${plugin.mcpServers
        .map((server) => {
          const environment = mcpServerEnvironment(server);
          return `• ${server.name}: ${mcpServerSummary(server)}${environment ? `\n  with ${environment}` : ""}`;
        })
        .join("\n")}`;
      const confirmed = (await requestConfirmDialog(message)) ?? window.confirm(message);
      if (!confirmed) return;
    }
    setBusy(true);
    const result = await setEnabled({
      environmentId,
      input: { id: plugin.id, enabled: !plugin.enabled },
    });
    setBusy(false);
    if (result._tag === "Failure") reportFailure("Could not change the plugin", result);
    onChanged();
  };

  const runUpdate = async () => {
    setBusy(true);
    const result = await update({ environmentId, input: { id: plugin.id } });
    setBusy(false);
    if (result._tag === "Failure") {
      reportFailure("Could not update the plugin", result);
    } else if (plugin.enabled && !result.value.plugin.enabled) {
      toastManager.add({
        type: "info",
        title: `${plugin.name} was turned off`,
        description: "Its MCP servers changed. Review them, then enable it again.",
      });
    }
    onChanged();
  };

  const runRemove = async () => {
    const message = `Remove ${plugin.name}?\nIts files are deleted from this machine.`;
    const confirmed =
      (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message);
    if (!confirmed) return;
    setBusy(true);
    const result = await remove({ environmentId, input: { id: plugin.id } });
    setBusy(false);
    if (result._tag === "Failure") reportFailure("Could not remove the plugin", result);
    onChanged();
  };

  const counts = [
    `${plugin.skills.length} ${plugin.skills.length === 1 ? "skill" : "skills"}`,
    ...(plugin.mcpServers.length === 0
      ? []
      : [
          `${plugin.mcpServers.length} MCP ${plugin.mcpServers.length === 1 ? "server" : "servers"}`,
        ]),
  ].join(" · ");

  return (
    <SettingsRow
      title={
        <span className="flex flex-wrap items-center gap-2">
          {plugin.name}
          {plugin.version ? (
            <span className="text-xs text-muted-foreground">{plugin.version}</span>
          ) : null}
        </span>
      }
      description={
        plugin.description ? <span className="line-clamp-2">{plugin.description}</span> : undefined
      }
      status={
        <div className="flex flex-wrap items-center gap-2">
          <span>{counts}</span>
          {plugin.formats.map((format) => (
            <Badge key={format} variant="outline" size="sm">
              {FORMAT_LABELS[format]}
            </Badge>
          ))}
          <span className="truncate text-muted-foreground">{pluginSourceLabel(plugin.source)}</span>
        </div>
      }
      control={
        <div className="flex items-center gap-2">
          <Switch
            checked={plugin.enabled}
            disabled={busy}
            aria-label={`Enable ${plugin.name}`}
            onCheckedChange={() => void toggle()}
          />
          <Menu>
            <MenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Actions for ${plugin.name}`}
                />
              }
            >
              <MoreHorizontalIcon className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={() => setDetailsOpen(true)}>
                <ScrollTextIcon />
                Details
              </MenuItem>
              <MenuItem onClick={() => void runUpdate()}>
                <RefreshCwIcon />
                {plugin.source.type === "git" ? "Update from repository" : "Reload from folder"}
              </MenuItem>
              <MenuSeparator />
              <MenuItem onClick={() => void runRemove()}>
                <Trash2Icon />
                Remove
              </MenuItem>
            </MenuPopup>
          </Menu>
          {detailsOpen ? (
            <PluginDetailsDialog plugin={plugin} onClose={() => setDetailsOpen(false)} />
          ) : null}
        </div>
      }
    />
  );
}

function PluginDetailsDialog({
  plugin,
  onClose,
}: {
  readonly plugin: InstalledPlugin;
  readonly onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{plugin.name}</DialogTitle>
          <DialogDescription>{pluginSourceLabel(plugin.source)}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-6">
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Skills</h3>
              {plugin.skills.length === 0 ? (
                <p className="text-sm text-muted-foreground">This plugin has no skills.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {plugin.skills.map((skill) => (
                    <li key={skill.path} className="flex gap-2 py-2 text-sm">
                      {/* Plugin skills are the "app" source kind in the slash menu too. */}
                      <SkillKindGlyph kind="app" className="mt-0.5 size-4 shrink-0" />
                      <div className="min-w-0">
                        <span className="font-medium">{skill.name}</span>
                        {skill.description ? (
                          <p className="text-muted-foreground">{skill.description}</p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-medium">MCP servers</h3>
              {plugin.mcpServers.length === 0 ? (
                <p className="text-sm text-muted-foreground">This plugin runs no MCP servers.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {plugin.mcpServers.map((server) => (
                    <li key={server.name} className="space-y-1 py-2 text-sm">
                      <span className="font-medium">{server.name}</span>
                      <code className="block break-all text-xs text-muted-foreground">
                        {mcpServerSummary(server)}
                      </code>
                      {mcpServerEnvironment(server) ? (
                        <code className="block break-all text-xs text-muted-foreground">
                          Environment: {mcpServerEnvironment(server)}
                        </code>
                      ) : null}
                      {server.envVars.length > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Reads environment variables: {server.envVars.join(", ")}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button size="sm" />}>Done</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function InstallPluginDialog({
  environmentId,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
}) {
  const [sourceType, setSourceType] = useState<PluginSource["type"]>("git");
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("");
  const [folder, setFolder] = useState("");
  const [installing, setInstalling] = useState(false);
  const install = useAtomCommand(serverEnvironment.installPlugin, { label: "plugin install" });
  const pluginsQuery = useEnvironmentQuery(serverEnvironment.plugins({ environmentId, input: {} }));

  const source: PluginSource | null =
    sourceType === "git"
      ? url.trim()
        ? { type: "git", url: url.trim(), ...(ref.trim() ? { ref: ref.trim() } : {}) }
        : null
      : folder.trim()
        ? { type: "folder", path: folder.trim() }
        : null;

  const submit = async () => {
    if (source === null || installing) return;
    setInstalling(true);
    const result = await install({ environmentId, input: { source } });
    setInstalling(false);
    if (result._tag === "Failure") {
      reportFailure("Could not install the plugin", result);
      return;
    }
    pluginsQuery.refresh();
    toastManager.add({
      type: "success",
      title: `Installed ${result.value.plugin.name}`,
      description: "It starts turned off. Enable it to give agents its skills.",
    });
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !installing) onClose();
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
            <DialogTitle>Add plugin</DialogTitle>
            <DialogDescription>
              Codex and Claude Code plugin folders work as they are, as does a folder of skills. The
              plugin starts turned off.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-4">
              <ToggleGroup
                aria-label="Plugin source"
                value={[sourceType]}
                onValueChange={(values) => {
                  const next = values[0];
                  if (next === "git" || next === "folder") setSourceType(next);
                }}
              >
                <Toggle value="git">Git repository</Toggle>
                <Toggle value="folder">Folder on this machine</Toggle>
              </ToggleGroup>
              {sourceType === "git" ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="plugin-git-url">Repository URL</Label>
                    <Input
                      id="plugin-git-url"
                      value={url}
                      placeholder="https://github.com/owner/plugin.git"
                      autoFocus
                      onChange={(event) => setUrl(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="plugin-git-ref">Branch or tag (optional)</Label>
                    <Input
                      id="plugin-git-ref"
                      value={ref}
                      onChange={(event) => setRef(event.target.value)}
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="plugin-folder">Folder path</Label>
                  <Input
                    id="plugin-folder"
                    value={folder}
                    placeholder="/path/to/plugin"
                    autoFocus
                    onChange={(event) => setFolder(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    The folder is copied, so later edits need Reload from folder.
                  </p>
                </div>
              )}
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" size="sm" disabled={installing} />}>
              Cancel
            </DialogClose>
            <Button type="submit" size="sm" disabled={source === null || installing}>
              {installing ? "Installing…" : "Install"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
