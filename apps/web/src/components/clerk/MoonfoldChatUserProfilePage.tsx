import {
  MoonfoldCHAT_PLAN_TUNNEL_LIMITS,
  type RelayMoonfoldChatLink,
} from "@moonfold/contracts/relay";
import { MessageSquareIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useManagedTunnelUsage } from "../../cloud/managedRelayState";
import { MoonfoldCHAT_SUBSCRIPTION_URL, TunnelUsageMeter } from "../cloud/TunnelUsage";
import { Button } from "../ui/button";
import {
  ClerkUserProfilePage,
  ClerkUserProfileRefreshButton,
  ClerkUserProfileRow,
} from "./ClerkUserProfilePage";
import { useMoonfoldChatLink } from "./useMoonfoldChatLink";

const upgradeLink = (
  <a
    className="underline"
    href={MoonfoldCHAT_SUBSCRIPTION_URL}
    target="_blank"
    rel="noopener noreferrer"
  >
    Upgrade on Moonfold Chat
  </a>
);

function planLabel(link: RelayMoonfoldChatLink): ReactNode {
  switch (link.plan) {
    case "premier":
      return `Premier · up to ${MoonfoldCHAT_PLAN_TUNNEL_LIMITS.premier} tunnels`;
    case "pro":
      return (
        <>
          Pro · up to {MoonfoldCHAT_PLAN_TUNNEL_LIMITS.pro} tunnels. {upgradeLink} to Premier for{" "}
          {MoonfoldCHAT_PLAN_TUNNEL_LIMITS.premier}.
        </>
      );
    case "free":
      return <>{upgradeLink} for more tunnels</>;
  }
}

/** Links a Moonfold Chat account so paid subscribers get more tunnels. */
export function MoonfoldChatUserProfilePage() {
  const {
    linkState,
    pending,
    linkUrl,
    link: handleLink,
    unlink: handleUnlink,
  } = useMoonfoldChatLink();
  const usage = useManagedTunnelUsage();

  const data = linkState.data;
  const link = data?.link ?? null;

  return (
    <ClerkUserProfilePage
      title="Moonfold Chat"
      description={`Link a paid Moonfold Chat account for more Moonfold Connect tunnels: up to ${MoonfoldCHAT_PLAN_TUNNEL_LIMITS.pro} with Pro, ${MoonfoldCHAT_PLAN_TUNNEL_LIMITS.premier} with Premier.`}
      action={
        <ClerkUserProfileRefreshButton
          disabled={pending !== null}
          isPending={linkState.isPending}
          onClick={usage.refresh}
        />
      }
    >
      {linkState.error ? (
        <div className="border-t py-3 text-xs" role="alert">
          <p className="font-medium text-destructive-foreground">
            Could not load Moonfold Chat link
          </p>
          <p className="mt-0.5 text-muted-foreground">{linkState.error}</p>
        </div>
      ) : data === null ? null : !data.available ? (
        <p className="border-t py-4 text-xs text-muted-foreground">
          This Moonfold Connect server does not support Moonfold Chat linking.
        </p>
      ) : (
        <ul className="border-t">
          <ClerkUserProfileRow icon={<MessageSquareIcon className="size-4" />}>
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm leading-4.5 font-medium text-foreground">
                  {link ? link.email : "Not linked"}
                </h3>
                <p className="mt-1 text-xs leading-4.5 text-muted-foreground">
                  {link ? (
                    planLabel(link)
                  ) : linkUrl ? (
                    <>
                      Confirm on{" "}
                      <a
                        className="underline"
                        href={linkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        t3.chat
                      </a>
                      , then select Refresh.
                    </>
                  ) : (
                    "You confirm the link on t3.chat."
                  )}
                </p>
              </div>
              {link ? (
                <Button
                  size="sm"
                  variant="destructive-outline"
                  disabled={pending !== null}
                  onClick={() => void handleUnlink()}
                >
                  {pending === "unlink" ? "Unlinking…" : "Unlink"}
                </Button>
              ) : (
                <Button size="sm" disabled={pending !== null} onClick={() => void handleLink()}>
                  {pending === "link" ? "Opening…" : "Link Moonfold Chat"}
                </Button>
              )}
            </div>
          </ClerkUserProfileRow>
          {usage.used !== null && usage.limit !== null ? (
            <li className="border-t py-4">
              <TunnelUsageMeter used={usage.used} limit={usage.limit} />
            </li>
          ) : null}
        </ul>
      )}
    </ClerkUserProfilePage>
  );
}
