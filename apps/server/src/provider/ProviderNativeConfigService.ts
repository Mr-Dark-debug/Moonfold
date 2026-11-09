/**
 * ProviderNativeConfigService - the provider's own configuration (MCP servers, skills, hooks,
 * imports, account usage) for Settings and agents. It resolves the instance and project, then
 * calls the instance's `nativeConfig` capability; providers without one answer with a setup error.
 *
 * @module provider/ProviderNativeConfigService
 */
import {
  ProviderSetupError,
  type ProjectId,
  type ProviderAccountUsage,
  type ProviderAgentImportDetectResult,
  type ProviderAgentImportInput,
  type ProviderAgentImportResult,
  type ProviderHookList,
  type ProviderInstanceId,
  type ProviderMcpServerList,
  type ProviderMcpServerLoginEvent,
  type ProviderMcpServerLoginInput,
  type ProviderNativeConfigInput,
  type ProviderSkillList,
  type ProviderSkillReadInput,
  type ProviderSkillReadResult,
  type ProviderSkillSetEnabledInput,
  type ProviderSkillSetEnabledResult,
} from "@moonfold/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { ProviderInstance } from "@moonfold/provider-core/server/driver";

import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderInstanceRegistry from "./ProviderInstanceRegistry.ts";

const isProviderSetupError = Schema.is(ProviderSetupError);

/** SKILL.md files are short; anything past this is cut off in the viewer. */
const SKILL_READ_LIMIT_BYTES = 256 * 1024;

type NativeConfig = NonNullable<ProviderInstance["nativeConfig"]>;

export class ProviderNativeConfigService extends Context.Service<
  ProviderNativeConfigService,
  {
    readonly listMcpServers: (
      input: ProviderNativeConfigInput,
    ) => Effect.Effect<ProviderMcpServerList, ProviderSetupError>;
    readonly loginMcpServer: (
      input: ProviderMcpServerLoginInput,
    ) => Stream.Stream<ProviderMcpServerLoginEvent, ProviderSetupError>;
    readonly reloadMcpServers: (
      input: ProviderNativeConfigInput,
    ) => Effect.Effect<void, ProviderSetupError>;
    readonly listSkills: (
      input: ProviderNativeConfigInput,
    ) => Effect.Effect<ProviderSkillList, ProviderSetupError>;
    readonly setSkillEnabled: (
      input: ProviderSkillSetEnabledInput,
    ) => Effect.Effect<ProviderSkillSetEnabledResult, ProviderSetupError>;
    /** Reads a SKILL.md the provider lists for that scope, and no other file. */
    readonly readSkill: (
      input: ProviderSkillReadInput,
    ) => Effect.Effect<ProviderSkillReadResult, ProviderSetupError>;
    readonly listHooks: (
      input: ProviderNativeConfigInput,
    ) => Effect.Effect<ProviderHookList, ProviderSetupError>;
    readonly detectAgentImports: (
      input: ProviderNativeConfigInput,
    ) => Effect.Effect<ProviderAgentImportDetectResult, ProviderSetupError>;
    readonly importAgentConfig: (
      input: ProviderAgentImportInput,
    ) => Effect.Effect<ProviderAgentImportResult, ProviderSetupError>;
    readonly readAccountUsage: (
      input: ProviderNativeConfigInput,
    ) => Effect.Effect<ProviderAccountUsage, ProviderSetupError>;
  }
>()("moonfold/provider/ProviderNativeConfigService") {}

const make = Effect.gen(function* () {
  const providerInstances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const projects = yield* ProjectService.ProjectService;
  const fileSystem = yield* FileSystem.FileSystem;

  const setupError = (
    instanceId: ProviderInstanceId,
    operation: string,
    detail: string,
    cause?: unknown,
  ) =>
    new ProviderSetupError({
      instanceId,
      operation,
      detail,
      ...(cause === undefined ? {} : { cause }),
    });

  const configFor = Effect.fn("ProviderNativeConfigService.configFor")(function* (
    instanceId: ProviderInstanceId,
    operation: string,
  ) {
    const instance = yield* providerInstances.getInstance(instanceId);
    if (instance === undefined) {
      return yield* setupError(instanceId, operation, "Provider instance not found.");
    }
    if (!instance.enabled) {
      return yield* setupError(instanceId, operation, "This provider is disabled.");
    }
    if (instance.nativeConfig === undefined) {
      return yield* setupError(
        instanceId,
        operation,
        "This provider does not expose its configuration to Moonfold.",
      );
    }
    return instance.nativeConfig;
  });

  const projectCwd = (
    instanceId: ProviderInstanceId,
    operation: string,
    projectId: ProjectId | undefined,
  ) =>
    projectId === undefined
      ? Effect.undefined
      : projects.getById(projectId).pipe(
          Effect.mapError((cause) =>
            setupError(instanceId, operation, "The project is unavailable.", cause),
          ),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(setupError(instanceId, operation, "Project not found.")),
              onSome: (project) => Effect.succeed(project.workspaceRoot),
            }),
          ),
        );

  /** Runs one capability call with the project's directory, mapping driver errors. */
  const run = Effect.fn("ProviderNativeConfigService.run")(function* <A>(
    input: { readonly instanceId: ProviderInstanceId; readonly projectId?: ProjectId | undefined },
    operation: string,
    use: (
      config: NativeConfig,
      cwd: string | undefined,
    ) => Effect.Effect<A, ProviderSetupError | { readonly detail: string }>,
  ) {
    const annotations = { instanceId: input.instanceId, operation };
    yield* Effect.annotateCurrentSpan(annotations);
    const config = yield* configFor(input.instanceId, operation);
    const cwd = yield* projectCwd(input.instanceId, operation, input.projectId);
    return yield* use(config, cwd).pipe(
      Effect.mapError((error) =>
        isProviderSetupError(error)
          ? error
          : setupError(input.instanceId, operation, error.detail, error),
      ),
      Effect.annotateSpans(annotations),
    );
  });

  const listSkills = (input: ProviderNativeConfigInput) =>
    run(input, "list-skills", (config, cwd) => config.listSkills(cwd));

  const readSkill = Effect.fn("ProviderNativeConfigService.readSkill")(function* (
    input: ProviderSkillReadInput,
  ) {
    const { skills } = yield* listSkills(input);
    if (!skills.some((skill) => skill.path === input.path)) {
      return yield* setupError(
        input.instanceId,
        "read-skill",
        "That skill is not one this provider lists.",
      );
    }
    const bytes = yield* fileSystem
      .readFile(input.path)
      .pipe(
        Effect.mapError((cause) =>
          setupError(input.instanceId, "read-skill", "The skill file could not be read.", cause),
        ),
      );
    const truncated = bytes.byteLength > SKILL_READ_LIMIT_BYTES;
    return {
      contents: new TextDecoder().decode(
        truncated ? bytes.subarray(0, SKILL_READ_LIMIT_BYTES) : bytes,
      ),
      truncated,
    };
  });

  return ProviderNativeConfigService.of({
    listMcpServers: Effect.fn("ProviderNativeConfigService.listMcpServers")((input) =>
      run(input, "list-mcp-servers", (config) => config.listMcpServers()),
    ),
    loginMcpServer: (input) =>
      Stream.unwrap(
        configFor(input.instanceId, "login-mcp-server").pipe(
          Effect.map((config) =>
            config
              .loginMcpServer(input.name)
              .pipe(
                Stream.mapError((error) =>
                  setupError(input.instanceId, "login-mcp-server", error.detail, error),
                ),
              ),
          ),
        ),
      ),
    reloadMcpServers: Effect.fn("ProviderNativeConfigService.reloadMcpServers")((input) =>
      run(input, "reload-mcp-servers", (config) => config.reloadMcpServers()),
    ),
    listSkills,
    setSkillEnabled: Effect.fn("ProviderNativeConfigService.setSkillEnabled")((input) =>
      run(input, "set-skill-enabled", (config) =>
        config.setSkillEnabled({ path: input.path, enabled: input.enabled }),
      ),
    ),
    readSkill,
    listHooks: Effect.fn("ProviderNativeConfigService.listHooks")((input) =>
      run(input, "list-hooks", (config, cwd) => config.listHooks(cwd)),
    ),
    detectAgentImports: Effect.fn("ProviderNativeConfigService.detectAgentImports")((input) =>
      run(input, "detect-agent-imports", (config, cwd) => config.detectAgentImports(cwd)),
    ),
    importAgentConfig: Effect.fn("ProviderNativeConfigService.importAgentConfig")((input) =>
      run(input, "import-agent-config", (config, cwd) =>
        config.importAgentConfig({ cwd, itemIds: input.itemIds }),
      ),
    ),
    readAccountUsage: Effect.fn("ProviderNativeConfigService.readAccountUsage")((input) =>
      run(input, "read-account-usage", (config) => config.readAccountUsage()),
    ),
  });
});

export const layer = Layer.effect(ProviderNativeConfigService, make);
