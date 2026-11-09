// Context tags are runtime singletons; drivers need multiple instances.
import type {
  ProviderConsumeResetCreditOutcome,
  AcpRegistryListSessionsResult,
  AcpRegistryListProvidersResult,
  AcpRegistryOperationError,
  AcpRegistrySetProviderInput,
  ProviderAccountUsage,
  ProviderAgentImportDetectResult,
  ProviderAgentImportResult,
  ProviderDriverKind,
  ProviderHookList,
  ResolvedProviderInstanceEnvironment,
  ProviderInstanceId,
  ProviderMcpServerList,
  ProviderMcpServerLoginEvent,
  ProviderSkillList,
  ProviderSkillSetEnabledResult,
  ServerProvider,
  ServerProviderWorkspaceSnapshot,
} from "@moonfold/contracts";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";
import type * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import type * as ProviderAdapter from "./ProviderAdapter.ts";
import type { ProviderAuthController } from "./auth.ts";
import type { ProviderDriverError } from "./errors.ts";
import type { ManagedServerProvider } from "./snapshot.ts";
import type { ProviderTextGeneration } from "./textGeneration.ts";
import type { ProviderUsageReader } from "./usage.ts";

export interface ProviderDriverMetadata {
  readonly displayName: string;
  /** Defaults to true; false rejects multiple instances of a global resource. */
  readonly supportsMultipleInstances?: boolean;
  readonly hasDefaultInstance?: boolean;
}

export type ProviderWorkspaceSnapshot = ServerProvider &
  Pick<ServerProviderWorkspaceSnapshot, "slashCommandsPending" | "optionDescriptors">;

export interface ProviderInstance {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly continuationIdentity: ProviderContinuationIdentity;
  readonly displayName: string | undefined;
  readonly accentColor?: string | undefined;
  readonly enabled: boolean;
  readonly snapshot: ManagedServerProvider;
  readonly snapshotForCwd?: (
    cwd: string,
  ) => Effect.Effect<ProviderWorkspaceSnapshot, ProviderDriverError>;
  readonly refreshModels?: () => Effect.Effect<void, ProviderDriverError>;
  readonly invalidateCaches?: Effect.Effect<void>;
  readonly consumeResetCredit?: () => Effect.Effect<
    ProviderConsumeResetCreditOutcome,
    ProviderDriverError
  >;
  readonly orchestrationAdapter: ProviderAdapter.ProviderAdapterV2["Service"];
  readonly textGeneration: ProviderTextGeneration;
  readonly auth?: ProviderAuthController;
  /**
   * Configuration the provider keeps in its own home: MCP servers, skills,
   * hooks, imports from other agents and account usage. `cwd` adds that
   * project's config; without it only user-level config is read.
   */
  readonly nativeConfig?: {
    readonly listMcpServers: () => Effect.Effect<ProviderMcpServerList, ProviderDriverError>;
    /** Streams the URL to open, then the outcome once the browser finishes. */
    readonly loginMcpServer: (
      name: string,
    ) => Stream.Stream<ProviderMcpServerLoginEvent, ProviderDriverError>;
    readonly reloadMcpServers: () => Effect.Effect<void, ProviderDriverError>;
    readonly listSkills: (
      cwd: string | undefined,
    ) => Effect.Effect<ProviderSkillList, ProviderDriverError>;
    readonly setSkillEnabled: (input: {
      readonly path: string;
      readonly enabled: boolean;
    }) => Effect.Effect<ProviderSkillSetEnabledResult, ProviderDriverError>;
    readonly listHooks: (
      cwd: string | undefined,
    ) => Effect.Effect<ProviderHookList, ProviderDriverError>;
    readonly detectAgentImports: (
      cwd: string | undefined,
    ) => Effect.Effect<ProviderAgentImportDetectResult, ProviderDriverError>;
    readonly importAgentConfig: (input: {
      readonly cwd: string | undefined;
      readonly itemIds: ReadonlyArray<string>;
    }) => Effect.Effect<ProviderAgentImportResult, ProviderDriverError>;
    readonly readAccountUsage: () => Effect.Effect<ProviderAccountUsage, ProviderDriverError>;
    /** Mirrors Moonfold's archive state onto the provider's own copy of a thread. */
    readonly setThreadArchived: (input: {
      readonly nativeThreadId: string;
      readonly archived: boolean;
    }) => Effect.Effect<void, ProviderDriverError>;
  };
  readonly acpSessionManagement?: {
    readonly listSessions: (input: {
      readonly cwd: string;
      readonly cursor?: string;
    }) => Effect.Effect<AcpRegistryListSessionsResult, AcpRegistryOperationError>;
    readonly logout: (cwd: string) => Effect.Effect<void, AcpRegistryOperationError>;
    readonly deleteSession: (input: {
      readonly cwd: string;
      readonly sessionId: string;
    }) => Effect.Effect<void, AcpRegistryOperationError>;
    readonly listProviders: (
      cwd: string,
    ) => Effect.Effect<AcpRegistryListProvidersResult, AcpRegistryOperationError>;
    readonly setProvider: (
      input: Omit<AcpRegistrySetProviderInput, "instanceId" | "projectId"> & {
        readonly cwd: string;
      },
    ) => Effect.Effect<void, AcpRegistryOperationError>;
    readonly disableProvider: (input: {
      readonly cwd: string;
      readonly providerId: string;
    }) => Effect.Effect<void, AcpRegistryOperationError>;
  };
}

export interface ProviderContinuationIdentity {
  readonly driverKind: ProviderDriverKind;
  readonly continuationKey: string;
}

export function defaultProviderContinuationIdentity(input: {
  readonly driverKind: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
}): ProviderContinuationIdentity {
  return {
    driverKind: input.driverKind,
    continuationKey: `${input.driverKind}:instance:${input.instanceId}`,
  };
}

export interface ProviderDriverCreateInput<Config> {
  readonly instanceId: ProviderInstanceId;
  readonly displayName: string | undefined;
  readonly accentColor?: string | undefined;
  readonly environment: ResolvedProviderInstanceEnvironment;
  readonly enabled: boolean;
  readonly config: Config;
}

/** create calls with different instanceId/config must share no mutable state. */
export interface ProviderDriver<Config, R = never, UsageR = never> {
  readonly driverKind: ProviderDriverKind;
  readonly metadata: ProviderDriverMetadata;
  // Codec keeps DecodingServices = never; Schema would widen it through AnyProviderDriver.
  readonly configSchema: Schema.Codec<Config, unknown>;
  readonly defaultConfig: () => Config;
  /** Failures become unavailable snapshots; never throw defects. */
  readonly create: (
    input: ProviderDriverCreateInput<Config>,
  ) => Effect.Effect<ProviderInstance, ProviderDriverError, R | Scope.Scope>;
  readonly usage?: ProviderUsageReader<Config, UsageR>;
}

export type AnyProviderDriver<R = never, UsageR = unknown> = ProviderDriver<any, R, UsageR>;

export type ProviderUsageReaderEnv<Driver> =
  Driver extends ProviderDriver<any, any, infer UsageR> ? UsageR : never;
