import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProviderDriverKind } from "@moonfold/contracts";
import { InfoIcon } from "lucide-react";

import { serverEnvironment } from "../../state/server";
import { Alert, AlertDescription } from "../ui/alert";

const DOCS_URL = "https://github.com/Mr-Dark-debug/Moonfold/blob/main/docs/user";

const PROVIDER_ACCOUNT_DOCS = new Map<string, { name: string; url: string }>([
  ["codex", { name: "Codex", url: `${DOCS_URL}/providers-codex.md#use-multiple-accounts` }],
  [
    "claudeAgent",
    { name: "Claude", url: `${DOCS_URL}/providers-claude.md#separate-accounts-or-configurations` },
  ],
]);

/** Shown while adding a Claude or Codex account when the environment already has one signed in. */
export function MultipleAccountsNote({
  environmentId,
  driver,
}: {
  readonly environmentId: EnvironmentId;
  readonly driver: ProviderDriverKind;
}) {
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const providerDocs = PROVIDER_ACCOUNT_DOCS.get(driver);
  const providerName = providerDocs?.name;
  const hasSignedInAccount =
    providerName !== undefined &&
    providers?.some(
      (provider) => provider.driver === driver && provider.auth.status === "authenticated",
    );
  if (!hasSignedInAccount) return null;
  return (
    <Alert variant="info" role="note">
      <InfoIcon aria-hidden />
      <AlertDescription>
        <p>
          We do not recommend managing multiple {providerName} accounts in Moonfold.{" "}
          <a
            href={providerDocs?.url}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            More info
          </a>
        </p>
      </AlertDescription>
    </Alert>
  );
}
