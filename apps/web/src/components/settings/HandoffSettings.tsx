import {
  DEFAULT_PROVIDER_HANDOFF_SETTINGS,
  type ModelSelection,
  type ProviderHandoffSettings,
  type ProviderInstanceId,
} from "@moonfold/contracts";
import { createModelSelection } from "@moonfold/shared/model";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getCustomModelOptionsByInstance } from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { defaultModelSlug, handoffWarnLabel, moveFallback } from "./handoffSettings.logic";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

const WARN_CHOICES = ["off", "70", "80", "90", "95"] as const;

export function HandoffSettingsPanel() {
  const { scope, target } = useSettingsScope();
  const settings = useScopedSettings();
  const handoff = settings.providerHandoff;
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["providerHandoff"]);
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const { environments } = useEnvironments();
  const representative = target
    ? environments.find((environment) => environment.environmentId === target.environmentId)
    : undefined;
  const providersByEnvironment = useEnvironmentProviders();
  const providers =
    (representative?.serverConfig
      ? providersByEnvironment.get(representative.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const entries = providerInstanceEntriesFor(providers, settings, target?.projectId ?? null);
  const enabledEntries = entries.filter((entry) => entry.enabled);
  const firstEntry = enabledEntries[0];
  const [adding, setAdding] = useState<ModelSelection | null>(null);
  // Reordering moves or unmounts the focused button; this puts focus back on the same row, or
  // on the row that took the removed one's place.
  const fallbackListRef = useRef<HTMLOListElement>(null);
  const refocus = useRef<{ key: string; action: "up" | "down" | "remove"; index: number } | null>(
    null,
  );
  // oxlint-disable-next-line moonfold/no-unreasoned-state-sync -- moves DOM focus back to the reordered row after the list re-renders
  useEffect(() => {
    const target = refocus.current;
    const list = fallbackListRef.current;
    if (target === null || list === null) return;
    refocus.current = null;
    if (handoff.fallbackOrder.length === 0) return;
    const rows = [...list.querySelectorAll<HTMLLIElement>("li[data-fallback-key]")];
    const row =
      target.action === "remove"
        ? rows[Math.min(target.index, rows.length - 1)]
        : rows.find((candidate) => candidate.dataset.fallbackKey === target.key);
    const buttons = [
      ...(row?.querySelectorAll<HTMLButtonElement>("button[data-fallback-action]") ?? []),
    ];
    const preferred = buttons.find(
      (button) => button.dataset.fallbackAction === target.action && !button.disabled,
    );
    (preferred ?? buttons.find((button) => !button.disabled))?.focus();
  }, [handoff.fallbackOrder]);
  const modelOptions = getCustomModelOptionsByInstance(
    settings,
    providers,
    adding?.instanceId ?? firstEntry?.instanceId,
    adding?.model,
  );

  // What the picker shows before a choice is what Add adds.
  const defaultSlug =
    firstEntry === undefined ? null : defaultModelSlug(modelOptions.get(firstEntry.instanceId));
  const candidate =
    adding ??
    (firstEntry === undefined || defaultSlug === null
      ? null
      : createModelSelection(firstEntry.instanceId, defaultSlug));
  const update = (patch: Partial<ProviderHandoffSettings>) =>
    updateSettings({ providerHandoff: { ...handoff, ...patch } });
  const nameOf = (instanceId: ProviderInstanceId) =>
    entries.find((entry) => entry.instanceId === instanceId)?.displayName ?? instanceId;

  return (
    <SettingsPageContainer>
      <SettingsSection id="handoff" title="Handoff">
        <SettingsRow
          {...searchableSetting("handoff-mode")}
          serverScoped
          settingKeys={["providerHandoff"]}
          mixed={mixed}
          description={
            handoff.mode === "auto"
              ? "Continue in the first available agent in the fallback order without asking."
              : "Offer to continue in another agent, and show what will be sent first."
          }
          resetAction={
            handoff.mode !== DEFAULT_PROVIDER_HANDOFF_SETTINGS.mode ? (
              <SettingResetButton label="handoff mode" onClick={() => update({ mode: "ask" })} />
            ) : null
          }
          control={
            <Select
              value={mixed ? null : handoff.mode}
              onValueChange={(next) => {
                if (next === "ask" || next === "auto") update({ mode: next });
              }}
            >
              <SelectTrigger size="sm" aria-label="Handoff mode">
                <SelectValue>
                  {mixed ? "Mixed" : handoff.mode === "auto" ? "Automatic" : "Ask"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="ask">Ask</SelectItem>
                <SelectItem value="auto">Automatic</SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...searchableSetting("handoff-fallback-order")}
          serverScoped
          settingKeys={["providerHandoff"]}
          mixed={mixed}
          description={
            handoff.fallbackOrder.length === 0
              ? "Add the agents a limited thread should continue in, first choice first."
              : "A limited thread continues in the first agent here that is on, allowed and not at its own limit."
          }
        >
          <ol ref={fallbackListRef} className="mt-2 space-y-1.5">
            {handoff.fallbackOrder.map((selection, index) => {
              const key = `${selection.instanceId}:${selection.model}`;
              const label = `${nameOf(selection.instanceId)} ${selection.model}`;
              return (
                <li
                  key={key}
                  data-fallback-key={key}
                  className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
                >
                  <span className="w-5 text-muted-foreground tabular-nums">{index + 1}.</span>
                  <span className="min-w-0 flex-1 truncate">
                    {nameOf(selection.instanceId)} · {selection.model}
                  </span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Move ${label} up`}
                    data-fallback-action="up"
                    disabled={index === 0}
                    onClick={() => {
                      refocus.current = { key, action: "up", index };
                      update({ fallbackOrder: moveFallback(handoff.fallbackOrder, index, -1) });
                    }}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Move ${label} down`}
                    data-fallback-action="down"
                    disabled={index === handoff.fallbackOrder.length - 1}
                    onClick={() => {
                      refocus.current = { key, action: "down", index };
                      update({ fallbackOrder: moveFallback(handoff.fallbackOrder, index, 1) });
                    }}
                  >
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Remove ${label}`}
                    data-fallback-action="remove"
                    onClick={() => {
                      refocus.current = { key, action: "remove", index };
                      update({
                        fallbackOrder: handoff.fallbackOrder.filter(
                          (_, position) => position !== index,
                        ),
                      });
                    }}
                  >
                    <XIcon />
                  </Button>
                </li>
              );
            })}
          </ol>
          {firstEntry ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ProviderModelPicker
                environmentId={representative?.environmentId ?? null}
                activeInstanceId={adding?.instanceId ?? firstEntry.instanceId}
                model={candidate?.model ?? ""}
                lockedProvider={null}
                instanceEntries={enabledEntries}
                modelOptionsByInstance={modelOptions}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                triggerAriaLabel="Agent to add to the fallback order"
                onInstanceModelChange={(instanceId, model) =>
                  setAdding(createModelSelection(instanceId, model))
                }
              />
              <Button
                size="sm"
                variant="outline"
                disabled={
                  candidate === null ||
                  handoff.fallbackOrder.some(
                    (entry) =>
                      entry.instanceId === candidate.instanceId && entry.model === candidate.model,
                  )
                }
                onClick={() => {
                  if (candidate === null) return;
                  update({ fallbackOrder: [...handoff.fallbackOrder, candidate] });
                  setAdding(null);
                }}
              >
                <PlusIcon /> Add
              </Button>
            </div>
          ) : null}
        </SettingsRow>
        <SettingsRow
          {...searchableSetting("handoff-allowed-providers")}
          serverScoped
          settingKeys={["providerHandoff"]}
          mixed={mixed}
          description={
            handoff.allowedProviders === null
              ? "Every enabled agent may continue a thread and receive its context."
              : isProjectScope
                ? "Only these agents receive this project's threads."
                : "Only these agents receive threads; projects can choose their own."
          }
        >
          <div className="mt-2 space-y-1.5">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={handoff.allowedProviders === null}
                onCheckedChange={(checked) =>
                  update({
                    allowedProviders:
                      checked === true ? null : enabledEntries.map((entry) => entry.instanceId),
                  })
                }
              />
              Every enabled agent
            </label>
            {handoff.allowedProviders !== null
              ? entries.map((entry) => (
                  <label key={entry.instanceId} className="flex items-center gap-2 pl-6 text-sm">
                    <Checkbox
                      checked={handoff.allowedProviders?.includes(entry.instanceId) ?? false}
                      onCheckedChange={(checked) => {
                        const current = handoff.allowedProviders ?? [];
                        update({
                          allowedProviders:
                            checked === true
                              ? [...current, entry.instanceId]
                              : current.filter((id) => id !== entry.instanceId),
                        });
                      }}
                    />
                    {entry.displayName}
                  </label>
                ))
              : null}
          </div>
        </SettingsRow>
        <SettingsRow
          {...searchableSetting("handoff-usage-warning")}
          serverScoped
          settingKeys={["providerHandoff"]}
          mixed={mixed}
          description="When an agent reports this much of a usage window used, the thread offers to continue elsewhere. Only agents that report usage take part."
          control={
            <Select
              value={
                mixed
                  ? null
                  : handoff.warnAtUsagePercent === null
                    ? "off"
                    : String(handoff.warnAtUsagePercent)
              }
              onValueChange={(next) => {
                if (next === null) return;
                update({ warnAtUsagePercent: next === "off" ? null : Number(next) });
              }}
            >
              <SelectTrigger size="sm" aria-label="Usage warning">
                <SelectValue>
                  {mixed ? "Mixed" : handoffWarnLabel(handoff.warnAtUsagePercent)}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {WARN_CHOICES.map((choice) => (
                  <SelectItem key={choice} value={choice}>
                    {handoffWarnLabel(choice === "off" ? null : Number(choice))}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
