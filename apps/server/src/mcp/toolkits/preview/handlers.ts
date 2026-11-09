import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Record from "effect/Record";
import * as Schema from "effect/Schema";
import {
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PREVIEW_RECORDING_STOP_TIMEOUT_MS,
  PreviewAutomationRecordingTransferError,
  PreviewAutomationRecordingDesktopUpdateRequiredError,
  PreviewAutomationRecordingArtifact,
  PreviewAutomationActInputs,
  OrchestratorMcpFailure,
  type ToolActivityIcon,
  type ThreadId,
  type PreviewAutomationOperation,
  type PreviewAutomationOpenInput,
  type PreviewAutomationRecordingStatus,
  type PreviewAutomationResizeResult,
  type PreviewAutomationSetColorSchemeResult,
  type PreviewAutomationSnapshot,
  type PreviewAutomationStatus,
  type PreviewTabId,
  type BrowserSiteCapability,
} from "@moonfold/contracts";

import {
  parseAttachmentUuid,
  parseAttachmentFileExtension,
  PENDING_ATTACHMENT_THREAD_SEGMENT,
  toSafeThreadAttachmentSegment,
} from "../../../attachmentStore.ts";
import { resolveAttachmentRelativePath } from "../../../attachmentPaths.ts";
import * as ServerConfig from "../../../config.ts";
import * as BrowserSitePermissions from "../../../browser/BrowserSitePermissions.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as PreviewAutomationBroker from "../../PreviewAutomationBroker.ts";
import { PreviewSnapshotToolkit, PreviewStandardToolkit, PreviewToolkit } from "./tools.ts";

/** Whether a preview the agent
 * said nothing about surfaces is the user's `browserAutoShowFloatingPreview`
 * preference, which is desktop-local and unreadable from here — filling in
 * `true` would silently override it for every `preview_open`.
 */
function normalizePreviewOpenInput(input: PreviewAutomationOpenInput): PreviewAutomationOpenInput {
  const open = input.open ?? input.show;
  return {
    ...input,
    ...(open === undefined ? {} : { open, show: open }),
    reuseExistingTab: input.reuseExistingTab ?? true,
  };
}

const invoke = Effect.fn("PreviewToolkit.invoke")(function* <A>(
  operation: PreviewAutomationOperation,
  input: unknown,
  timeoutMs?: number,
  tabId?: PreviewTabId,
): Effect.fn.Return<
  { result: A; toolIcon?: ToolActivityIcon },
  import("@moonfold/contracts").PreviewAutomationError,
  McpInvocationContext.McpInvocationContext | PreviewAutomationBroker.PreviewAutomationBroker
> {
  const scope = yield* McpInvocationContext.requireThreadMcpCapability("preview");
  const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
  let targetTabId = tabId;
  const result = yield* broker.invoke<A>({
    onTargetTab: (resolvedTabId) => {
      targetTabId = resolvedTabId;
    },
    scope,
    operation,
    input,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(tabId === undefined ? {} : { tabId }),
  });
  if (["status", "open", "navigate", "snapshot"].includes(operation)) return { result };
  const statusTabId =
    (operation !== "evaluate" && typeof result === "object" && result !== null
      ? (result as { tabId?: PreviewTabId }).tabId
      : undefined) ?? targetTabId;
  const page = yield* broker
    .invoke<PreviewAutomationStatus>({
      scope,
      operation: "status",
      input: {},
      timeoutMs: 500,
      updateCurrentTab: false,
      ...(statusTabId === undefined ? {} : { tabId: statusTabId }),
    })
    .pipe(Effect.orElseSucceed(() => null));
  return {
    result,
    ...(page?.url && /^https?:\/\//i.test(page.url) && page.url.length <= 4096
      ? { toolIcon: { _tag: "website" as const, pageUrl: page.url } }
      : {}),
  };
});

const invokeTargeted = <A extends object>(
  operation: PreviewAutomationOperation,
  input: {
    readonly tabId?: PreviewTabId | undefined;
    readonly [key: string]: unknown;
  },
  timeoutMs?: number,
) => {
  const { tabId, ...operationInput } = input;
  return invoke<A>(operation, operationInput, timeoutMs, tabId).pipe(
    Effect.map(({ result, toolIcon }) => ({
      ...result,
      ...(toolIcon ? { toolIcon } : {}),
    })),
  );
};

/**
 * Asks the user's site rules before an agent opens a page or hands a page files. Tab actions also
 * check the page the tab is on, before acting and again after anything that can navigate, so a
 * redirect, link or script cannot carry the agent onto a blocked site and keep working there.
 */
const checkSite = Effect.fn("checkSite")(function* (
  capability: BrowserSiteCapability,
  url: string | null | undefined,
) {
  if (url === null || url === undefined) return;
  const scope = yield* McpInvocationContext.McpInvocationContext;
  if (scope.thread === undefined) return;
  const sites = yield* BrowserSitePermissions.BrowserSitePermissions;
  yield* sites
    .check({ threadId: scope.thread.threadId, url, capability })
    .pipe(
      Effect.mapError(
        (denied) =>
          new OrchestratorMcpFailure({ code: "capability_denied", message: denied.message }),
      ),
    );
});

/** The page the targeted tab shows now, or null when there is no tab yet. */
const currentPage = (tabId: PreviewTabId | undefined) =>
  invokeTargeted<PreviewAutomationStatus>("status", tabId === undefined ? {} : { tabId }).pipe(
    Effect.map((status) => status.url),
  );

const checkCurrentPage = (tabId: PreviewTabId | undefined) =>
  currentPage(tabId).pipe(Effect.flatMap((url) => checkSite("browse", url)));

/** Runs a tab action only on an allowed page; `navigates` checks where the tab ended up too. */
const onAllowedPage = <A, E, R>(
  tabId: PreviewTabId | undefined,
  action: Effect.Effect<A, E, R>,
  navigates = false,
) =>
  checkCurrentPage(tabId).pipe(
    Effect.andThen(action),
    Effect.tap(() => (navigates ? checkCurrentPage(tabId) : Effect.void)),
  );

const decodeActInput = Record.map(PreviewAutomationActInputs, (schema) =>
  Schema.decodeUnknownEffect(schema),
);

/** Page actions that can navigate, so site rules check where the tab ended up too. */
const ACT_MAY_NAVIGATE: { readonly [A in keyof typeof PreviewAutomationActInputs]: boolean } = {
  click: true,
  type: true,
  hover: false,
  select: true,
  drag: true,
  upload: false,
  press: true,
  scroll: false,
};

const UploadedRecordingArtifact = Schema.Struct({
  ...PreviewAutomationRecordingArtifact.fields,
  uploadedAttachmentId: Schema.optional(Schema.String),
});
const decodeUploadedRecordingArtifact = Schema.decodeUnknownEffect(UploadedRecordingArtifact);

export const claimPreviewRecording = Effect.fn("PreviewToolkit.claimRecording")(function* (
  threadId: ThreadId,
  response: unknown,
) {
  const artifact = yield* decodeUploadedRecordingArtifact(response).pipe(
    Effect.mapError(
      (cause) =>
        new PreviewAutomationRecordingTransferError({
          threadId,
          cause,
        }),
    ),
  );
  if (!artifact.uploadedAttachmentId) {
    return yield* new PreviewAutomationRecordingDesktopUpdateRequiredError({ threadId });
  }
  const config = yield* ServerConfig.ServerConfig;
  const uuid = parseAttachmentUuid(artifact.uploadedAttachmentId);
  const extension = parseAttachmentFileExtension(artifact.uploadedAttachmentId);
  const threadSegment = toSafeThreadAttachmentSegment(threadId);
  const pendingId = `${PENDING_ATTACHMENT_THREAD_SEGMENT}-${uuid}-${extension}`;
  if (!uuid || !extension || !threadSegment || artifact.uploadedAttachmentId !== pendingId) {
    return yield* new PreviewAutomationRecordingTransferError({
      threadId,
    });
  }
  const finalId = `${threadSegment}-${uuid}-${extension}`;
  const currentPath = resolveAttachmentRelativePath({
    attachmentsDir: config.attachmentsDir,
    relativePath: `${pendingId}.${extension}`,
  });
  const finalPath = resolveAttachmentRelativePath({
    attachmentsDir: config.attachmentsDir,
    relativePath: `${finalId}.${extension}`,
  });
  if (!currentPath || !finalPath) {
    return yield* new PreviewAutomationRecordingTransferError({ threadId });
  }
  const fileSystem = yield* FileSystem.FileSystem;
  const validateFile = (filePath: string) =>
    fileSystem.stat(filePath).pipe(
      Effect.filterOrFail(
        (stat) =>
          stat.type === "File" &&
          Number(stat.size) === artifact.sizeBytes &&
          artifact.sizeBytes > 0 &&
          artifact.sizeBytes <= PROVIDER_SEND_TURN_MAX_FILE_BYTES,
        () => new PreviewAutomationRecordingTransferError({ threadId }),
      ),
    );
  yield* Effect.gen(function* () {
    yield* validateFile(currentPath);
    yield* fileSystem.rename(currentPath, finalPath);
  }).pipe(
    Effect.catchIf(
      (cause) =>
        cause._tag !== "PreviewAutomationRecordingTransferError" &&
        cause.reason._tag === "NotFound",
      () => validateFile(finalPath),
    ),
    Effect.mapError((cause) => new PreviewAutomationRecordingTransferError({ threadId, cause })),
  );
  const { uploadedAttachmentId: _uploadedAttachmentId, ...recording } = artifact;
  return { ...recording, id: finalId, path: finalPath };
});

const handlers = {
  preview_dialog: McpToolAccess.actsAsCaller((input) =>
    invokeTargeted<PreviewAutomationStatus>("dialog", input),
  ),
  preview_status: McpToolAccess.readsAsCaller((input) =>
    invokeTargeted<PreviewAutomationStatus>("status", input ?? {}),
  ),
  // Models often pass a dev server as both `url` and `target`; the target knows the environment.
  // Site rules check the address asked for and, after redirects, the page the tab landed on.
  preview_open: McpToolAccess.actsAsCaller(({ target, url, ...input }) =>
    Effect.gen(function* () {
      if (target === undefined) yield* checkSite("browse", url);
      const opened = yield* invokeTargeted<PreviewAutomationStatus>(
        "open",
        normalizePreviewOpenInput(
          target === undefined && url !== undefined ? { ...input, url } : input,
        ),
      );
      if (target === undefined || opened.tabId === null) {
        yield* checkSite("browse", opened.url);
        return opened;
      }
      const navigated = yield* invokeTargeted<PreviewAutomationStatus>("navigate", {
        target,
        tabId: opened.tabId,
      });
      yield* checkSite("browse", navigated.url);
      return navigated;
    }),
  ),
  preview_navigate: McpToolAccess.actsAsCaller((input) =>
    checkSite("browse", input.url).pipe(
      Effect.andThen(invokeTargeted<PreviewAutomationStatus>("navigate", input, input.timeoutMs)),
      Effect.tap((status) => checkSite("browse", status.url)),
    ),
  ),
  preview_resize: McpToolAccess.actsAsCaller((input) =>
    invokeTargeted<PreviewAutomationResizeResult>("resize", input, input.timeoutMs),
  ),
  preview_set_appearance: McpToolAccess.actsAsCaller((input) =>
    invokeTargeted<PreviewAutomationSetColorSchemeResult>("setColorScheme", input),
  ),
  preview_snapshot: McpToolAccess.readsAsCaller((input) => {
    const { includeImage: _includeImage, save: _save, ...operationInput } = input ?? {};
    // A snapshot names the page it read, so it is checked without asking the tab first.
    return invokeTargeted<PreviewAutomationSnapshot>("snapshot", operationInput).pipe(
      Effect.tap((snapshot) => checkSite("browse", snapshot.url)),
    );
  }),
  preview_act: McpToolAccess.actsAsCaller(({ action, ...input }) =>
    decodeActInput[action](input).pipe(
      Effect.mapError(
        (cause) => new OrchestratorMcpFailure({ code: "invalid_request", message: cause.message }),
      ),
      Effect.flatMap((decoded) => {
        const run = invokeTargeted<object>(
          action,
          decoded,
          "timeoutMs" in decoded ? decoded.timeoutMs : undefined,
        );
        if (action === "upload") {
          return Effect.gen(function* () {
            // Cancelling a file picker hands the page nothing.
            if ("paths" in decoded && decoded.paths.length > 0) {
              const url = yield* currentPage(decoded.tabId);
              yield* checkSite("browse", url);
              yield* checkSite("upload", url);
            }
            return yield* run;
          });
        }
        return onAllowedPage(decoded.tabId, run, ACT_MAY_NAVIGATE[action]);
      }),
    ),
  ),
  preview_evaluate: McpToolAccess.actsAsCaller(({ tabId, ...input }) =>
    onAllowedPage(
      tabId,
      invoke<unknown>("evaluate", input, undefined, tabId).pipe(
        Effect.map(({ result, toolIcon }) => ({
          value: result ?? null,
          ...(toolIcon ? { toolIcon } : {}),
        })),
      ),
      true,
    ),
  ),
  preview_wait_for: McpToolAccess.readsAsCaller((input) =>
    onAllowedPage(input.tabId, invokeTargeted<object>("waitFor", input, input.timeoutMs), true),
  ),
  preview_recording_start: McpToolAccess.actsAsCaller((input) =>
    invokeTargeted<PreviewAutomationRecordingStatus>("recordingStart", input ?? {}),
  ),
  preview_recording_stop: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireThreadMcpCapability("preview");
      const { tabId, ...operationInput } = input;
      const response = yield* invoke<unknown>(
        "recordingStop",
        { ...operationInput, transferToEnvironment: true },
        PREVIEW_RECORDING_STOP_TIMEOUT_MS,
        tabId,
      );
      const artifact = yield* claimPreviewRecording(scope.thread.threadId, response.result);
      return { ...artifact, ...(response.toolIcon ? { toolIcon: response.toolIcon } : {}) };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof PreviewToolkit.tools>;

const { preview_snapshot, ...standardHandlers } = handlers;

export const layerStandard = McpToolAccess.toLayer(PreviewStandardToolkit, standardHandlers);

export const layerSnapshot = McpToolAccess.toLayer(PreviewSnapshotToolkit, {
  preview_snapshot,
});
