import { createFileRoute } from "@tanstack/react-router";

import { OrbitPage } from "../components/orbit/OrbitPage";

export const Route = createFileRoute("/_chat/orbit")({
  component: OrbitPage,
});
