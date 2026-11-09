/**
 * Codex's own configuration (MCP servers, skills, hooks, agent imports and account usage), read
 * and changed through a short-lived `codex app-server` spawned per call under the instance's Codex
 * home, so it sees what Codex threads on that instance see.
 *
 * @module provider/codexNativeConfig
 */
import type {
  ProviderAccountUsage,
  ProviderAgentImportDetectResult,
  ProviderAgentImportItem,
  ProviderAgentImportResult,
  ProviderDriverKind,
  ProviderHookEntry,
  ProviderHookList,
  ProviderInstanceId,
  ProviderMcpServer,
  ProviderMcpServerList,
  ProviderMcpServerLoginEvent,
  ProviderSkillEntry,
  ProviderSkillList,
} from "@moonfold/contracts";
import type * as CodexClient from "effect-codex-app-server/client";
import type * as CodexErrors from "effect-codex-app-server/errors";
import type * as CodexSchema from "effect-codex-app-server/schema";
import type * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type { ProviderInstance } from "@moonfold/provider-core/server/driver";

import { ProviderDriverError } from "./Errors.ts";

const isProviderDriverError = Schema.is(ProviderDriverError);

type CodexAppServerClient = CodexClient.CodexAppServerClient["Service"];
type NativeConfig = NonNullable<ProviderInstance["nativeConfig"]>;

/** How long Codex waits for the browser to finish an MCP server's OAuth sign-in. */
const MCP_LOGIN_TIMEOUT_SECONDS = 300;
const CALL_TIMEOUT: Duration.Input = "30 seconds";
/** Importing sessions copies whole transcripts, which takes longer than a lookup. */
const IMPORT_TIMEOUT: Duration.Input = "10 minutes";

function codexMcpServerFromStatus(
  status: CodexSchema.V2ListMcpServerStatusResponse["data"][number],
): ProviderMcpServer {
  return {
    name: status.name,
    auth: status.authStatus,
    state: status.runtimeStatus ?? null,
    origin: status.httpOrigin ?? null,
    pluginId: status.pluginId ?? null,
    toolNames: Object.keys(status.tools).toSorted(),
    resourceCount: status.resources.length + status.resourceTemplates.length,
    error: status.toolsError ?? null,
  };
}

function codexSkillListFromResponse(response: CodexSchema.V2SkillsListResponse): ProviderSkillList {
  const seen = new Set<string>();
  const skills: Array<ProviderSkillEntry> = [];
  const errors: Array<{ path: string; message: string }> = [];
  for (const entry of response.data) {
    errors.push(...entry.errors.map(({ path, message }) => ({ path, message })));
    for (const skill of entry.skills) {
      // A user skill shows up once per listed directory.
      if (seen.has(skill.path)) continue;
      seen.add(skill.path);
      skills.push({
        name: skill.name,
        displayName: skill.interface?.displayName ?? null,
        description: skill.interface?.shortDescription ?? skill.description,
        path: skill.path,
        scope: skill.scope,
        enabled: skill.enabled,
        pluginId: skill.pluginId ?? null,
      });
    }
  }
  return { skills, errors };
}

function codexHookListFromResponse(response: CodexSchema.V2HooksListResponse): ProviderHookList {
  const seen = new Set<string>();
  const hooks: Array<ProviderHookEntry> = [];
  const warnings: Array<string> = [];
  const errors: Array<{ path: string; message: string }> = [];
  for (const entry of response.data) {
    warnings.push(...entry.warnings);
    errors.push(...entry.errors.map(({ path, message }) => ({ path, message })));
    for (const hook of entry.hooks.toSorted((a, b) => a.displayOrder - b.displayOrder)) {
      if (seen.has(hook.key)) continue;
      seen.add(hook.key);
      hooks.push({
        key: hook.key,
        event: hook.eventName,
        handler: hook.handlerType,
        target:
          hook.handlerType === "command"
            ? hook.command
            : hook.handlerType === "mcpTool"
              ? `${hook.server}/${hook.tool}`
              : null,
        matcher: hook.matcher ?? null,
        source: hook.source,
        sourcePath: hook.sourcePath,
        enabled: hook.enabled,
        trust: hook.trustStatus,
        managed: hook.isManaged,
        timeoutSec: Math.max(0, Math.round(hook.timeoutSec)),
      });
    }
  }
  return { hooks, warnings: [...new Set(warnings)], errors };
}

type CodexImportItem = CodexSchema.V2ExternalAgentConfigDetectResponse["items"][number];

/** Stable for one detection result; import re-detects and matches on it. */
function codexImportItemId(item: CodexImportItem): string {
  return JSON.stringify([item.itemType, item.cwd ?? null, item.description]);
}

function importEntryName(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (typeof entry !== "object" || entry === null) return null;
  for (const key of ["name", "title", "path", "source"] as const) {
    const value = (entry as Record<string, unknown>)[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function codexImportItemFromDetected(item: CodexImportItem): ProviderAgentImportItem {
  const details = (item.details ?? {}) as Record<string, unknown>;
  const entries = Object.values(details).flatMap((value) =>
    Array.isArray(value) ? value.map(importEntryName).filter((name) => name !== null) : [],
  );
  return {
    id: codexImportItemId(item),
    kind: item.itemType,
    description: item.description,
    cwd: item.cwd ?? null,
    entries,
  };
}

function codexImportResultFromCompleted(
  completed: CodexSchema.V2ExternalAgentConfigImportCompletedNotification,
): ProviderAgentImportResult {
  return {
    results: completed.itemTypeResults.map((result) => ({
      kind: result.itemType,
      imported: result.successes.length,
      failed: result.failures.length,
      errors: result.failures.map((failure) => failure.message),
    })),
  };
}

function codexAccountUsageFromResponse(
  response: CodexSchema.V2GetAccountTokenUsageResponse,
): ProviderAccountUsage {
  const count = (value: number | null | undefined) =>
    value === null || value === undefined ? null : Math.max(0, Math.round(value));
  const summary = response.summary;
  return {
    lifetimeTokens: count(summary?.lifetimeTokens),
    peakDailyTokens: count(summary?.peakDailyTokens),
    currentStreakDays: count(summary?.currentStreakDays),
    longestStreakDays: count(summary?.longestStreakDays),
    longestTurnSeconds: count(summary?.longestRunningTurnSec),
    days: (response.dailyUsageBuckets ?? [])
      .map((bucket) => ({ date: bucket.startDate, tokens: count(bucket.tokens) ?? 0 }))
      .toSorted((a, b) => a.date.localeCompare(b.date)),
  };
}

/**
 * Builds the native config capability for one Codex instance. `open` spawns an
 * initialized app-server client in the given directory, scoped to the caller.
 */
export function makeCodexNativeConfig<OpenError>(input: {
  readonly driver: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  /** Directory for user-scoped calls, so no project's config leaks in. */
  readonly userCwd: string;
  readonly open: (
    cwd: string,
  ) => Effect.Effect<{ readonly client: CodexAppServerClient }, OpenError, Scope.Scope>;
}): NativeConfig {
  const driverError = (detail: string, cause?: unknown) =>
    new ProviderDriverError({
      driver: input.driver,
      instanceId: input.instanceId,
      detail,
      ...(cause === undefined ? {} : { cause }),
    });
  // An error that already explains itself keeps its own detail.
  const fail =
    (detail: string) =>
    (
      cause: OpenError | CodexErrors.CodexAppServerError | ProviderDriverError | Cause.TimeoutError,
    ) =>
      isProviderDriverError(cause) ? cause : driverError(detail, cause);
  const call = <A>(
    cwd: string | undefined,
    detail: string,
    use: (
      client: CodexAppServerClient,
    ) => Effect.Effect<A, CodexErrors.CodexAppServerError | ProviderDriverError>,
    timeout: Duration.Input = CALL_TIMEOUT,
  ): Effect.Effect<A, ProviderDriverError> =>
    input.open(cwd ?? input.userCwd).pipe(
      Effect.flatMap(({ client }) => use(client)),
      Effect.timeout(timeout),
      Effect.scoped,
      Effect.mapError(fail(detail)),
    );
  const cwds = (cwd: string | undefined) => (cwd === undefined ? [input.userCwd] : [cwd]);

  const loginMcpServer = (
    name: string,
  ): Stream.Stream<ProviderMcpServerLoginEvent, ProviderDriverError> =>
    Stream.unwrap(
      Effect.gen(function* () {
        // The app-server that starts the sign-in must stay up to receive its callback.
        const { client } = yield* input.open(input.userCwd);
        const completed = yield* Deferred.make<ProviderMcpServerLoginEvent>();
        yield* client.handleServerNotification("mcpServer/oauthLogin/completed", (payload) =>
          payload.name === name
            ? Deferred.succeed(completed, {
                type: "completed",
                success: payload.success,
                error: payload.error ?? null,
              }).pipe(Effect.asVoid)
            : Effect.void,
        );
        const { authorizationUrl } = yield* client.request("mcpServer/oauth/login", {
          name,
          timeoutSecs: MCP_LOGIN_TIMEOUT_SECONDS,
        });
        const outcome = Deferred.await(completed).pipe(
          Effect.timeoutOrElse({
            duration: `${MCP_LOGIN_TIMEOUT_SECONDS + 10} seconds`,
            orElse: () =>
              Effect.succeed<ProviderMcpServerLoginEvent>({
                type: "completed",
                success: false,
                error: "The sign-in was not finished in time.",
              }),
          }),
        );
        const opened: ProviderMcpServerLoginEvent = {
          type: "authorizationUrl",
          url: authorizationUrl,
        };
        return Stream.concat(Stream.succeed(opened), Stream.fromEffect(outcome));
      }).pipe(Effect.mapError(fail(`Codex could not start the sign-in for '${name}'.`))),
    );

  return {
    listMcpServers: () =>
      call(undefined, "Codex could not list its MCP servers.", (client) =>
        client.request("mcpServerStatus/list", { detail: "toolsAndAuthOnly" }).pipe(
          Effect.map((response): ProviderMcpServerList => ({
            servers: response.data
              .map(codexMcpServerFromStatus)
              .toSorted((a, b) => a.name.localeCompare(b.name)),
          })),
        ),
      ),
    loginMcpServer,
    reloadMcpServers: () =>
      call(undefined, "Codex could not reload its MCP servers.", (client) =>
        client.request("config/mcpServer/reload", undefined).pipe(Effect.asVoid),
      ),
    listSkills: (cwd) =>
      call(cwd, "Codex could not list its skills.", (client) =>
        client
          .request("skills/list", { cwds: cwds(cwd) })
          .pipe(Effect.map(codexSkillListFromResponse)),
      ),
    setSkillEnabled: ({ path, enabled }) =>
      call(undefined, "Codex could not change the skill.", (client) =>
        client
          .request("skills/config/write", { path, enabled })
          .pipe(Effect.map((response) => ({ enabled: response.effectiveEnabled }))),
      ),
    listHooks: (cwd) =>
      call(cwd, "Codex could not list its hooks.", (client) =>
        client
          .request("hooks/list", { cwds: cwds(cwd) })
          .pipe(Effect.map(codexHookListFromResponse)),
      ),
    detectAgentImports: (cwd) =>
      call(cwd, "Codex could not look for other agents' configuration.", (client) =>
        client
          .request("externalAgentConfig/detect", {
            includeHome: true,
            ...(cwd === undefined ? {} : { cwds: [cwd] }),
          })
          .pipe(
            Effect.map((response): ProviderAgentImportDetectResult => ({
              items: response.items.map(codexImportItemFromDetected),
            })),
          ),
      ),
    importAgentConfig: ({ cwd, itemIds }) =>
      call(
        cwd,
        "Codex could not import the selected configuration.",
        (client) =>
          Effect.gen(function* () {
            // Only items Codex itself detects can be imported, never client-supplied ones.
            const detected = yield* client.request("externalAgentConfig/detect", {
              includeHome: true,
              ...(cwd === undefined ? {} : { cwds: [cwd] }),
            });
            const wanted = new Set(itemIds);
            const migrationItems = detected.items.filter((item) =>
              wanted.has(codexImportItemId(item)),
            );
            if (migrationItems.length === 0) {
              return yield* driverError("None of the selected items are still available.");
            }
            const completed =
              yield* Deferred.make<CodexSchema.V2ExternalAgentConfigImportCompletedNotification>();
            let importId: string | null = null;
            const early: Array<CodexSchema.V2ExternalAgentConfigImportCompletedNotification> = [];
            yield* client.handleServerNotification(
              "externalAgentConfig/import/completed",
              (payload) => {
                if (importId === null) {
                  early.push(payload);
                  return Effect.void;
                }
                return payload.importId === importId
                  ? Deferred.succeed(completed, payload).pipe(Effect.asVoid)
                  : Effect.void;
              },
            );
            const started = yield* client.request("externalAgentConfig/import", { migrationItems });
            importId = started.importId;
            const already = early.find((payload) => payload.importId === started.importId);
            if (already !== undefined) yield* Deferred.succeed(completed, already);
            return codexImportResultFromCompleted(yield* Deferred.await(completed));
          }),
        IMPORT_TIMEOUT,
      ),
    setThreadArchived: ({ nativeThreadId, archived }) =>
      call(
        undefined,
        `Codex could not ${archived ? "archive" : "unarchive"} the thread.`,
        (client) =>
          (archived
            ? client.request("thread/archive", { threadId: nativeThreadId })
            : client.request("thread/unarchive", { threadId: nativeThreadId })
          ).pipe(Effect.asVoid),
      ),
    readAccountUsage: () =>
      call(undefined, "Codex could not read the account's usage.", (client) =>
        client.request("account/usage/read", null).pipe(Effect.map(codexAccountUsageFromResponse)),
      ),
  };
}
