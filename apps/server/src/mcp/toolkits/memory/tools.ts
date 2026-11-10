import { MemoryId, MemoryKind, MemoryText, OrchestratorMcpFailure } from "@moonfold/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as MemoryStore from "../../../memories/MemoryStore.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const RememberTool = Tool.make("remember", {
  description:
    "Save something to remember across conversations: a lasting preference, or a fact about running this project. Use it when the user asks you to remember something or states a lasting preference. Also use it, with learned:true, when the user corrects how you work here in a way that will apply next time (a tool, a convention, a command that is the right one); the user may be shown it as a suggestion first. Never for task progress, details of this conversation, or anything secret. Write one short sentence in your own words. Set kind to environment for setup facts such as the install, test or lint command; otherwise leave it out. It applies to this thread's project. The user sees every memory in Settings → Memories. Fails when memories are off.",
  parameters: Schema.Struct({
    text: MemoryText,
    kind: Schema.optional(MemoryKind),
    learned: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Struct({ memoryId: MemoryId, message: Schema.String }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    MemoryStore.MemoryStore,
  ],
})
  .annotate(Tool.Title, "Remember")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const MemoryToolkit = Toolkit.make(RememberTool);
