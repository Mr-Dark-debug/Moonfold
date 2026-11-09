import type { ProviderDriverKind, ServerProvider } from "@moonfold/contracts";

import type { ProviderInstance } from "@moonfold/provider-core/server/driver";
import type { ServerProviderDraft } from "@moonfold/provider-core/server/snapshotProbe";

export const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly driverKind: ProviderDriverKind;
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: input.driverKind,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });
