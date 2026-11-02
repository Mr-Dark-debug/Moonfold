import { createFileRoute } from "@tanstack/react-router";

import { MobileSettingsPanel } from "../components/settings/MobileSettings";

export const Route = createFileRoute("/settings/mobile")({
  component: MobileSettingsPanel,
});
