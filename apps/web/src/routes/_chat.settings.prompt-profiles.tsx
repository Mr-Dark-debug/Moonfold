import { createFileRoute } from "@tanstack/react-router";

import { PromptProfilesSettingsPanel } from "../components/settings/PromptProfilesSettings";

export const Route = createFileRoute("/_chat/settings/prompt-profiles")({
  component: PromptProfilesSettingsPanel,
});
