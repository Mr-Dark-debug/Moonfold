import { MOONFOLD_ACP_CATALOG_AGENT_IDS } from "@moonfold/contracts";

/**
 * ACP agents Moonfold lists in addition to the public ACP Registry (D-53), in the Registry's own
 * JSON shape. Only add agents that speak standard ACP over stdio, publish an exact-version
 * package, and run under the user's own credentials. A Registry entry with the same id wins.
 */
export const ACP_CATALOG_SUPPLEMENT: ReadonlyArray<unknown> = [
  {
    id: "deepseek-harness",
    name: "DeepSeek Harness",
    version: "0.2.1-rc.2",
    description:
      "DeepSeek's open-source plugin-based agent harness, run through its ACP profile. Uses the model providers configured in your own DeepSeek Harness setup.",
    authors: ["DeepSeek"],
    license: "MIT",
    repository: "https://github.com/deepseek-ai/deepseek-harness",
    distribution: {
      npx: {
        package: "@deepseek-ai/dsh@0.2.1-rc.2",
        args: ["--profile", "acp"],
      },
    },
  },
];

// Keep the contracts list (used for icons) in step with the entries above.
for (const entry of ACP_CATALOG_SUPPLEMENT) {
  const id = (entry as { id: string }).id;
  if (!MOONFOLD_ACP_CATALOG_AGENT_IDS.includes(id)) {
    throw new Error(`ACP catalog supplement entry ${id} is missing from contracts.`);
  }
}

/** Registry agents first; supplement entries only where the Registry has no agent with that id. */
export function withCatalogSupplement<A extends { readonly id: string }>(
  registryAgents: ReadonlyArray<A>,
  supplement: ReadonlyArray<A>,
): ReadonlyArray<A> {
  const ids = new Set(registryAgents.map((agent) => agent.id));
  return [...registryAgents, ...supplement.filter((agent) => !ids.has(agent.id))];
}
