import { isAtomCommandInterrupted } from "@moonfold/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@moonfold/contracts";

import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";

/** A menu waits at most this long for the thread's memory choice before opening without it. */
const STATUS_WAIT_MS = 400;

/**
 * A thread's "use memories" choice, for the thread menus: `read` when a menu opens (null when the
 * environment does not answer in time, which hides the item) and `choose` when the user picks.
 */
export function useThreadMemoryChoice() {
  const readStatus = useAtomCommand(serverEnvironment.readThreadMemoryStatus, {
    label: "thread memory choice",
    reportFailure: false,
  });
  const setOptOut = useAtomCommand(serverEnvironment.setThreadMemoryOptOut, {
    label: "change thread memory choice",
  });

  const read = (threadRef: ScopedThreadRef): Promise<boolean | null> =>
    Promise.race([
      readStatus({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      }).then((result) => (result._tag === "Success" ? result.value.optedOut : null)),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), STATUS_WAIT_MS)),
    ]);

  const choose = async (threadRef: ScopedThreadRef, optedOut: boolean): Promise<boolean> => {
    const result = await setOptOut({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, optedOut },
    });
    return result._tag === "Success" || isAtomCommandInterrupted(result);
  };

  return { read, choose };
}
