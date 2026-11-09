import {
  BrandExportResult,
  BrandInitResult,
  BrandManifest,
  BrandNameCheckInput,
  BrandNameCheckResult,
  BrandPrompt,
  BrandReference,
  BrandReferenceInput,
  BrandRenderInput,
  BrandRenderResult,
  BrandStatus,
  BrandStepInput,
  BrandValidationReport,
  OrchestratorMcpFailure,
} from "@moonfold/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as BrandKitService from "../../../brand/BrandKitService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  BrandKitService.BrandKitService,
];

const BrandInitTool = Tool.make("brand_init", {
  description:
    "Start a brand kit in this project's .moonfold/brand/: creates brand.json, README.md and the kit's folders, and keeps references/ out of git. Leaves an existing kit as it is and says so.",
  parameters: Schema.Struct({ prompt: BrandPrompt }),
  success: BrandInitResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Start brand kit")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const BrandStatusTool = Tool.make("brand_status", {
  description: "Read the brand kit's brand.json and its files by folder, with sizes.",
  success: BrandStatus,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Brand kit status")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const BrandStepTool = Tool.make("brand_step", {
  description:
    "Record a brand kit step's status in brand.json, with an optional note. An omitted note keeps the previous one.",
  parameters: BrandStepInput,
  success: BrandManifest,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Update brand kit step")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const BrandCheckNamesTool = Tool.make("brand_check_names", {
  description:
    "Look up up to 10 brand names: .com, .dev and .app domains (RDAP), GitHub and npm. Each lookup is available, taken or unknown. Not legal clearance: share trademarkSearchUrl.",
  parameters: BrandNameCheckInput,
  success: BrandNameCheckResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Check brand names")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const BrandKeepReferenceTool = Tool.make("brand_keep_reference", {
  description:
    "Keep a design reference in references/index.json with its source and why it was kept. screenshotPath: an absolute PNG path, such as preview_snapshot's with save=true; it is copied to references/shots/.",
  parameters: BrandReferenceInput,
  success: BrandReference,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Keep brand reference")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const BrandRenderTool = Tool.make("brand_render", {
  description:
    "Render an HTML file of the kit to a PNG. Both paths are relative to .moonfold/brand/; relative image paths in the page are inlined. width 240 to 1600 (default 728), appearance light or dark (default dark).",
  parameters: BrandRenderInput,
  success: BrandRenderResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Render brand page")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const BrandValidateTool = Tool.make("brand_validate", {
  description:
    "Check the brand kit: tokens/tokens.json shape and required roles, WCAG contrast for both themes, unsafe SVGs, font licenses, and that references/ stays out of git. Fix every error before brand_export.",
  success: BrandValidationReport,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Validate brand kit")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const BrandExportTool = Tool.make("brand_export", {
  description:
    "Generate exports/ (tokens.css, tailwind.css, tokens.scss, tokens.ts, tokens.json) from the tokens and render logo/*.svg and icons/app-icon.svg to PNG sizes. Fails while brand_validate reports errors.",
  success: BrandExportResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Export brand kit")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const BrandToolkit = Toolkit.make(
  BrandInitTool,
  BrandStatusTool,
  BrandStepTool,
  BrandCheckNamesTool,
  BrandKeepReferenceTool,
  BrandRenderTool,
  BrandValidateTool,
  BrandExportTool,
);
