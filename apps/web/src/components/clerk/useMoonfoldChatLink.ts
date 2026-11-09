import { findErrorTraceId } from "@moonfold/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@moonfold/client-runtime/state/runtime";
import { useState } from "react";

import {
  createManagedRelayMoonfoldChatLinkRequestCommand,
  unlinkManagedRelayMoonfoldChatCommand,
  useManagedRelayMoonfoldChatLink,
} from "../../cloud/managedRelayState";
import { readLocalApi } from "../../localApi";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";

function reportFailure(title: string, cause: unknown) {
  const traceId = findErrorTraceId(cause);
  toastManager.add({
    type: "error",
    title,
    description: cause instanceof Error ? cause.message : "Try again.",
    data: traceId
      ? {
          secondaryActionProps: {
            children: "Copy trace ID",
            onClick: () => void navigator.clipboard?.writeText(traceId),
          },
        }
      : undefined,
  });
}

/** Starts and removes the Moonfold Chat link that raises the Moonfold Connect tunnel cap. */
export function useMoonfoldChatLink() {
  const linkState = useManagedRelayMoonfoldChatLink();
  const createLinkRequest = useAtomCommand(createManagedRelayMoonfoldChatLinkRequestCommand, {
    reportFailure: false,
  });
  const unlinkCommand = useAtomCommand(unlinkManagedRelayMoonfoldChatCommand, {
    reportFailure: false,
  });
  const [pending, setPending] = useState<"link" | "unlink" | null>(null);
  // Kept so a blocked popup still leaves the user a link to open.
  const [linkUrl, setLinkUrl] = useState<string | null>(null);

  const link = async () => {
    const accountId = linkState.accountId;
    if (!accountId || pending) return;
    setPending("link");
    const result = await createLinkRequest({ accountId });
    if (result._tag === "Success") {
      setLinkUrl(result.value);
      await readLocalApi()
        ?.shell.openExternal(result.value)
        .catch(() => undefined);
    } else if (!isAtomCommandInterrupted(result)) {
      reportFailure("Could not start linking", squashAtomCommandFailure(result));
    }
    setPending(null);
  };

  const unlink = async () => {
    const accountId = linkState.accountId;
    if (!accountId || pending) return;
    setPending("unlink");
    const result = await unlinkCommand({ accountId });
    if (result._tag === "Success") {
      setLinkUrl(null);
      linkState.refresh();
    } else if (!isAtomCommandInterrupted(result)) {
      reportFailure("Could not unlink Moonfold Chat", squashAtomCommandFailure(result));
    }
    setPending(null);
  };

  return { linkState, pending, linkUrl, link, unlink };
}
