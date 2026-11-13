import { createFileRoute } from "@tanstack/react-router";

import { HandoffSettingsPanel } from "../components/settings/HandoffSettings";

export const Route = createFileRoute("/_chat/settings/handoff")({
  component: HandoffSettingsPanel,
});
