import { createFileRoute } from "@tanstack/react-router";

import { PersonalizationSettingsPanel } from "../components/settings/PersonalizationSettings";

export const Route = createFileRoute("/_chat/settings/personalization")({
  component: PersonalizationSettingsPanel,
});
