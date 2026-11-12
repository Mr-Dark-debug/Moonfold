import { OrchestratorMcpFailure } from "@moonfold/contracts";
import * as Effect from "effect/Effect";

import * as BrandKitService from "../../../brand/BrandKitService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { BrandToolkit } from "./tools.ts";

// Failures the agent can fix by changing what it passed or wrote; the rest are the environment's.
const INVALID_REQUEST_ERRORS = new Set([
  "BrandKitPathError",
  "BrandKitNotInitializedError",
  "BrandKitManifestError",
  "BrandKitInvalidError",
  "BrandKitScreenshotError",
  "BrandKitImageError",
  "HtmlRenderImageTooLargeError",
  "HtmlRenderPageTooLargeError",
  "HtmlRenderViewportHeightError",
]);

// Every service error carries a fixed, server-written message without file contents.
const toFailure = (error: { readonly _tag: string; readonly message: string }) =>
  new OrchestratorMcpFailure({
    code: INVALID_REQUEST_ERRORS.has(error._tag) ? "invalid_request" : "orchestration_error",
    message: error.message,
  });

/** The calling thread's kit: its worktree, or its project folder. */
const callerKit = McpInvocationContext.McpInvocationContext.pipe(
  Effect.flatMap((scope) => McpInvocationContext.requireThreadScope(scope, "This brand tool")),
  Effect.map((scope) => ({ threadId: scope.thread.threadId })),
);

const brand = BrandKitService.BrandKitService;

export const layer = McpToolAccess.toLayer(BrandToolkit, {
  brand_init: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const target = yield* callerKit;
      return yield* (yield* brand).init(target, input).pipe(Effect.mapError(toFailure));
    }),
  ),
  brand_status: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const target = yield* callerKit;
      return yield* (yield* brand).status(target).pipe(Effect.mapError(toFailure));
    }),
  ),
  brand_step: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const target = yield* callerKit;
      return yield* (yield* brand).setStep(target, input).pipe(Effect.mapError(toFailure));
    }),
  ),
  // Lookups name no project, so any approved client may run them.
  brand_check_names: McpToolAccess.reads((input) =>
    Effect.flatMap(brand, (service) => service.checkNames(input)),
  ),
  brand_keep_reference: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const target = yield* callerKit;
      return yield* (yield* brand).keepReference(target, input).pipe(Effect.mapError(toFailure));
    }),
  ),
  // Reads local images like html_preview, so only Moonfold-launched agents may use it.
  brand_render: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const target = yield* callerKit;
      return yield* (yield* brand).render(target, input).pipe(Effect.mapError(toFailure));
    }),
  ),
  brand_review_round: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const target = yield* callerKit;
      return yield* (yield* brand).recordReview(target, input).pipe(Effect.mapError(toFailure));
    }),
  ),
  brand_validate: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const target = yield* callerKit;
      return yield* (yield* brand).validate(target).pipe(Effect.mapError(toFailure));
    }),
  ),
  brand_export: McpToolAccess.actsAsCaller(() =>
    Effect.gen(function* () {
      const target = yield* callerKit;
      return yield* (yield* brand).exportKit(target).pipe(Effect.mapError(toFailure));
    }),
  ),
});
