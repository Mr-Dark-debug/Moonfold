import { OrchestratorMcpFailure } from "@moonfold/contracts";
import * as Effect from "effect/Effect";

import * as MemoryStore from "../../../memories/MemoryStore.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { loadCaller } from "../../threadAccess.ts";
import { MemoryToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(MemoryToolkit, {
  // A memory belongs to the user, so only an agent working in one of their threads saves one.
  remember: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { caller } = yield* loadCaller();
      if (caller === undefined) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "Only an agent working in a Moonfold thread can save a memory.",
        });
      }
      const store = yield* MemoryStore.MemoryStore;
      const memory = yield* store
        .remember({
          text: input.text,
          // Only the user widens a memory to every project; an agent's stays where it was saved.
          projectId: caller.projectId,
          threadId: caller.id,
          kind: input.kind,
          learned: input.learned,
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
          ),
        );
      return {
        memoryId: memory.id,
        message:
          memory.status === "suggested"
            ? "Kept as a suggestion: it applies only after the user accepts it in Settings → Memories. Mention that in a few words, once."
            : "Saved. Tell the user in a few words what you will remember; they can change it in Settings → Memories.",
      };
    }),
  ),
});
