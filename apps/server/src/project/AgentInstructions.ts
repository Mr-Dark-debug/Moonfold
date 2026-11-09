// @effect-diagnostics nodeBuiltinImport:off - Hashes file contents into an edit revision.
import * as NodeCrypto from "node:crypto";

/**
 * The instruction files agents read on their own (`AGENTS.md`, `CLAUDE.md`, project and user
 * level), for the Personalization settings. Only these four files can be read or written, and a
 * save from an outdated revision is refused so an edit made elsewhere is never overwritten.
 *
 * @module project/AgentInstructions
 */
import {
  AGENT_INSTRUCTIONS_MAX_BYTES,
  AgentInstructionsError,
  type AgentInstructionsFile,
  type AgentInstructionsFileId,
  type AgentInstructionsList,
  type AgentInstructionsListInput,
  type AgentInstructionsWriteInput,
  type AgentInstructionsWriteResult,
  type ProjectId,
} from "@moonfold/contracts";
import * as HostProcess from "@moonfold/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ProjectService from "./ProjectService.ts";

export class AgentInstructions extends Context.Service<
  AgentInstructions,
  {
    readonly list: (
      input: AgentInstructionsListInput,
    ) => Effect.Effect<AgentInstructionsList, AgentInstructionsError>;
    readonly write: (
      input: AgentInstructionsWriteInput,
    ) => Effect.Effect<AgentInstructionsWriteResult, AgentInstructionsError>;
  }
>()("moonfold/project/AgentInstructions") {}

export function instructionsRevision(contents: string): string {
  return NodeCrypto.createHash("sha256").update(contents).digest("hex");
}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projects = yield* ProjectService.ProjectService;
  const home = yield* HostProcess.HomeDirectory;
  const environment = yield* HostProcess.Environment;

  const ioError = (detail: string) => (cause: unknown) =>
    new AgentInstructionsError({ reason: "io", detail, cause });

  // The same homes the CLIs use when Moonfold starts them without a custom home.
  const codexHome = environment.CODEX_HOME?.trim() || path.join(home, ".codex");
  const claudeHome = environment.CLAUDE_CONFIG_DIR?.trim() || path.join(home, ".claude");

  const projectRoot = (projectId: ProjectId) =>
    projects.getById(projectId).pipe(
      Effect.mapError(ioError("The project could not be read.")),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new AgentInstructionsError({
                reason: "project_not_found",
                detail: "Project not found.",
              }),
            ),
          onSome: (project) => Effect.succeed(project.workspaceRoot),
        }),
      ),
    );

  const pathFor = Effect.fn("AgentInstructions.pathFor")(function* (
    id: AgentInstructionsFileId,
    projectId: ProjectId | undefined,
  ) {
    switch (id) {
      case "user-codex":
        return path.join(codexHome, "AGENTS.md");
      case "user-claude":
        return path.join(claudeHome, "CLAUDE.md");
      case "project-agents":
      case "project-claude": {
        if (projectId === undefined) {
          return yield* new AgentInstructionsError({
            reason: "project_not_found",
            detail: "Choose a project to edit its instructions.",
          });
        }
        const root = yield* projectRoot(projectId);
        return path.join(root, id === "project-agents" ? "AGENTS.md" : "CLAUDE.md");
      }
    }
  });

  const readFile = Effect.fn("AgentInstructions.readFile")(function* (
    id: AgentInstructionsFileId,
    filePath: string,
  ) {
    if (!(yield* fileSystem.exists(filePath).pipe(Effect.orElseSucceed(() => false)))) {
      return { id, path: filePath, contents: null, revision: null, tooLarge: false };
    }
    const info = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.mapError(ioError(`Could not read ${filePath}.`)));
    if (Number(info.size) > AGENT_INSTRUCTIONS_MAX_BYTES) {
      return { id, path: filePath, contents: null, revision: null, tooLarge: true };
    }
    const contents = yield* fileSystem
      .readFileString(filePath)
      .pipe(Effect.mapError(ioError(`Could not read ${filePath}.`)));
    return {
      id,
      path: filePath,
      contents,
      revision: instructionsRevision(contents),
      tooLarge: false,
    } satisfies AgentInstructionsFile;
  });

  const list: AgentInstructions["Service"]["list"] = Effect.fn("AgentInstructions.list")(
    function* (input) {
      const ids: ReadonlyArray<AgentInstructionsFileId> =
        input.projectId === undefined
          ? ["user-codex", "user-claude"]
          : ["project-agents", "project-claude", "user-codex", "user-claude"];
      const files = yield* Effect.forEach(ids, (id) =>
        pathFor(id, input.projectId).pipe(Effect.flatMap((filePath) => readFile(id, filePath))),
      );
      return { files };
    },
  );

  const write: AgentInstructions["Service"]["write"] = Effect.fn("AgentInstructions.write")(
    function* (input) {
      if (new TextEncoder().encode(input.contents).byteLength > AGENT_INSTRUCTIONS_MAX_BYTES) {
        return yield* new AgentInstructionsError({
          reason: "too_large",
          detail: "The instructions are larger than 512 KB.",
        });
      }
      const filePath = yield* pathFor(input.id, input.projectId);
      const current = yield* readFile(input.id, filePath);
      if (current.tooLarge || current.revision !== input.expectedRevision) {
        return yield* new AgentInstructionsError({
          reason: "changed_on_disk",
          detail: `${filePath} changed since it was opened. Reload it before saving.`,
        });
      }
      yield* fileSystem
        .makeDirectory(path.dirname(filePath), { recursive: true })
        .pipe(Effect.mapError(ioError(`Could not create ${path.dirname(filePath)}.`)));
      yield* fileSystem
        .writeFileString(filePath, input.contents)
        .pipe(Effect.mapError(ioError(`Could not write ${filePath}.`)));
      return { revision: instructionsRevision(input.contents) };
    },
  );

  return AgentInstructions.of({ list, write });
});

export const layer = Layer.effect(AgentInstructions, make);
