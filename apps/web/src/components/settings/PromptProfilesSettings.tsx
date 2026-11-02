import {
  DEFAULT_PROMPT_PROFILE_ID,
  PROMPT_PROFILE_MAX_CUSTOM,
  PROMPT_PROFILE_MAX_INSTRUCTIONS,
  PromptProfileId,
  listPromptProfiles,
  type PromptProfile,
} from "@moonfold/contracts";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { parseContentExclusions, parseRunTokenLimit } from "./agentLimits.logic";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import {
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

/** A fresh id that cannot collide with a built-in or another custom profile. */
function newProfileId(existing: ReadonlyArray<PromptProfile>): PromptProfile["id"] {
  const taken = new Set<string>(existing.map((profile) => profile.id));
  for (let attempt = 0; ; attempt += 1) {
    const id = `custom-${Date.now().toString(36)}${attempt === 0 ? "" : `-${attempt}`}`;
    if (!taken.has(id)) return PromptProfileId.make(id);
  }
}

/** Paths agents must leave alone (D-59) and the most tokens one run may add (D-60). */
function AgentLimitsSection() {
  const { scope } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const exclusionsMixed = useScopedSettingsMixed(["contentExclusions"]);
  const limitMixed = useScopedSettingsMixed(["runTokenLimit"]);
  const exclusions = settings.contentExclusions.join("\n");
  const scopeKey = JSON.stringify(scope);

  return (
    <SettingsSection id="agent-limits" title="Agent limits">
      <SettingsRow
        {...searchableSetting("content-exclusions")}
        serverScoped
        settingKeys={["contentExclusions"]}
        mixed={exclusionsMixed}
        description="Paths agents must leave alone, one per line, relative to the project. Claude Code's file tools are blocked from them. Other agents get them as an instruction, and any agent's shell commands can still reach them, so keep real secrets out of the project."
        resetAction={
          exclusionsMixed || settings.contentExclusions.length > 0 ? (
            <SettingResetButton
              label="content exclusions"
              onClick={() => updateSettings({ contentExclusions: [] })}
            />
          ) : null
        }
      >
        <div className="mt-3 max-w-2xl pb-3.5">
          <Textarea
            key={`${scopeKey}:${exclusionsMixed}:${exclusions}`}
            aria-label="Content exclusions"
            rows={4}
            defaultValue={exclusionsMixed ? "" : exclusions}
            placeholder={
              exclusionsMixed
                ? "Mixed. Enter paths to apply to all selected targets."
                : ".env\nsecrets/**"
            }
            onBlur={(event) => {
              const next = parseContentExclusions(event.target.value);
              if (exclusionsMixed || next.join("\n") !== exclusions) {
                updateSettings({ contentExclusions: next });
              }
            }}
          />
        </div>
      </SettingsRow>
      <SettingsRow
        {...searchableSetting("run-token-limit")}
        serverScoped
        settingKeys={["runTokenLimit"]}
        mixed={limitMixed}
        description="Stops a run once it has added this many tokens to its context, and holds any queued messages. Send a message to continue. It counts what Codex and Claude report during a turn; agents that report no usage are not limited."
        resetAction={
          limitMixed || settings.runTokenLimit !== null ? (
            <SettingResetButton
              label="token limit"
              onClick={() => updateSettings({ runTokenLimit: null })}
            />
          ) : null
        }
        control={
          <Input
            key={`${scopeKey}:${limitMixed}:${settings.runTokenLimit}`}
            aria-label="Token limit for one run"
            className="w-32"
            inputMode="numeric"
            defaultValue={limitMixed ? "" : (settings.runTokenLimit ?? "")}
            placeholder={limitMixed ? "Mixed" : "No limit"}
            onBlur={(event) => {
              const next = parseRunTokenLimit(event.target.value);
              if (limitMixed || next !== settings.runTokenLimit) {
                updateSettings({ runTokenLimit: next });
              }
            }}
          />
        }
      />
    </SettingsSection>
  );
}

/**
 * Settings > Prompt Profiles (D-54): which standing instructions Moonfold sends with every turn,
 * and the user's own profiles. Threads can pick another profile from the composer.
 */
export function PromptProfilesSettingsPanel() {
  const { scope } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const defaultMixed = useScopedSettingsMixed(["defaultPromptProfileId"]);
  const customMixed = useScopedSettingsMixed(["promptProfiles"]);
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const profiles = listPromptProfiles(settings.promptProfiles);
  const current = profiles.find((profile) => profile.id === settings.defaultPromptProfileId);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const saveCustom = (next: ReadonlyArray<PromptProfile>) =>
    updateSettings({ promptProfiles: next });

  return (
    <SettingsPageContainer>
      <SettingsSection id="prompt-profiles" title="Prompt profiles">
        <SettingsRow
          {...searchableSetting("prompt-profile-default")}
          serverScoped
          settingKeys={["defaultPromptProfileId"]}
          mixed={defaultMixed}
          description={
            current === undefined || current.id === DEFAULT_PROMPT_PROFILE_ID
              ? "Moonfold adds no standing instructions; each agent works the way its own harness tells it to. Pick another for one thread from its thread menu."
              : `${current.description} Sent with every turn, to every agent, on top of AGENTS.md and CLAUDE.md.`
          }
          resetAction={
            settings.defaultPromptProfileId !== DEFAULT_PROMPT_PROFILE_ID ? (
              <SettingResetButton
                label="default prompt profile"
                onClick={() =>
                  updateSettings({ defaultPromptProfileId: DEFAULT_PROMPT_PROFILE_ID })
                }
              />
            ) : null
          }
          control={
            <Select
              value={defaultMixed ? null : settings.defaultPromptProfileId}
              onValueChange={(value) => {
                const profile = profiles.find((candidate) => candidate.id === value);
                if (profile) updateSettings({ defaultPromptProfileId: profile.id });
              }}
            >
              <SelectTrigger size="sm" aria-label="Default prompt profile">
                <SelectValue>
                  {(value: string | null) =>
                    value === null
                      ? "Mixed"
                      : (profiles.find((profile) => profile.id === value)?.name ??
                        "Moonfold default")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...searchableSetting("prompt-profiles-custom")}
          serverScoped
          settingKeys={["promptProfiles"]}
          mixed={customMixed}
          description={
            isProjectScope
              ? "Profiles belong to the environment. Choose an environment above to add or edit them; a project can still pick its default."
              : "Built-in profiles are read-only. Your own profiles are stored in this environment's settings."
          }
        >
          <ul className="mt-2 space-y-2">
            {profiles.map((profile) => {
              const expanded = expandedId === profile.id;
              return (
                <li key={profile.id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{profile.name}</p>
                      <p className="truncate text-muted-foreground text-xs">
                        {profile.builtIn ? "Built in" : "Yours"}
                        {profile.description ? ` · ${profile.description}` : ""}
                      </p>
                    </div>
                    <Button
                      size="compact"
                      variant="ghost"
                      aria-expanded={expanded}
                      onClick={() => setExpandedId(expanded ? null : profile.id)}
                    >
                      {expanded ? "Close" : profile.builtIn || isProjectScope ? "View" : "Edit"}
                    </Button>
                    {!profile.builtIn && !isProjectScope ? (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Delete ${profile.name}`}
                        onClick={() =>
                          saveCustom(
                            settings.promptProfiles.filter((other) => other.id !== profile.id),
                          )
                        }
                      >
                        <Trash2Icon />
                      </Button>
                    ) : null}
                  </div>
                  {expanded ? (
                    profile.builtIn || isProjectScope ? (
                      <pre className="mt-2 whitespace-pre-wrap rounded bg-muted/50 p-2 text-muted-foreground text-xs">
                        {profile.instructions === ""
                          ? "No instructions: this profile adds nothing to a turn."
                          : profile.instructions}
                      </pre>
                    ) : (
                      <CustomProfileEditor
                        key={profile.id}
                        profile={profile}
                        onSave={(next) =>
                          saveCustom(
                            settings.promptProfiles.map((other) =>
                              other.id === next.id ? next : other,
                            ),
                          )
                        }
                      />
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
          {isProjectScope ? null : (
            <div className="mt-2">
              <Button
                size="sm"
                variant="outline"
                disabled={settings.promptProfiles.length >= PROMPT_PROFILE_MAX_CUSTOM}
                onClick={() => {
                  const profile: PromptProfile = {
                    id: newProfileId(profiles),
                    name: "My profile",
                    description: "",
                    instructions: "",
                  };
                  saveCustom([...settings.promptProfiles, profile]);
                  setExpandedId(profile.id);
                }}
              >
                <PlusIcon />
                New profile
              </Button>
            </div>
          )}
        </SettingsRow>
      </SettingsSection>
      <AgentLimitsSection />
    </SettingsPageContainer>
  );
}

function CustomProfileEditor({
  profile,
  onSave,
}: {
  profile: PromptProfile;
  onSave: (profile: PromptProfile) => void;
}) {
  const [name, setName] = useState(profile.name);
  const [description, setDescription] = useState(profile.description);
  const [instructions, setInstructions] = useState(profile.instructions);
  const trimmedName = name.trim();
  const changed =
    trimmedName !== profile.name ||
    description.trim() !== profile.description ||
    instructions !== profile.instructions;
  const valid =
    trimmedName.length > 0 &&
    trimmedName.length <= 80 &&
    description.trim().length <= 240 &&
    instructions.length <= PROMPT_PROFILE_MAX_INSTRUCTIONS;

  return (
    <div className="mt-2 space-y-2">
      <Input
        aria-label="Profile name"
        value={name}
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
      />
      <Input
        aria-label="Profile description"
        placeholder="One line about what this profile is for"
        value={description}
        maxLength={240}
        onChange={(event) => setDescription(event.target.value)}
      />
      <Textarea
        aria-label="Profile instructions"
        placeholder="Standing instructions every agent receives with each turn, for example: Prefer small commits and explain each change."
        rows={8}
        value={instructions}
        onChange={(event) => setInstructions(event.target.value)}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs tabular-nums">
          {instructions.length.toLocaleString()} /{" "}
          {PROMPT_PROFILE_MAX_INSTRUCTIONS.toLocaleString()}
        </span>
        <Button
          size="sm"
          disabled={!changed || !valid}
          onClick={() =>
            onSave({
              ...profile,
              name: trimmedName,
              description: description.trim(),
              instructions,
            })
          }
        >
          Save profile
        </Button>
      </div>
    </div>
  );
}
