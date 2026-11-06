import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { MOONFOLD_PROJECT_FILE_NAME, type MoonfoldProjectFile } from "@moonfold/contracts";
import { MoonfoldProjectFileFromJson } from "@moonfold/shared/moonfoldProjectFile";

const decodeMoonfoldProjectFileJson = Schema.decodeEffect(MoonfoldProjectFileFromJson);

export class MoonfoldProjectFileLoadError extends Schema.TaggedError<MoonfoldProjectFileLoadError>()(
  "MoonfoldProjectFileLoadError",
  {
    operation: Schema.Literals(["read", "decode"]),
    workspaceRoot: Schema.String,
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} ${MOONFOLD_PROJECT_FILE_NAME} at ${this.filePath}.`;
  }
}

export class MoonfoldProjectFileLoader extends Context.Service<
  MoonfoldProjectFileLoader,
  {
    /** Never fails; missing/unreadable/invalid files return none, with warnings for invalid files. */
    readonly load: (workspaceRoot: string) => Effect.Effect<Option.Option<MoonfoldProjectFile>>;
  }
>()("moonfold/project/MoonfoldProjectFileLoader") {}

const logMoonfoldProjectFileLoadError = (error: MoonfoldProjectFileLoadError) =>
  Effect.logWarning(error).pipe(
    Effect.annotateLogs({
      operation: error.operation,
      workspaceRoot: error.workspaceRoot,
      filePath: error.filePath,
      errorTag: error._tag,
    }),
  );

/** @public */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const load: MoonfoldProjectFileLoader["Service"]["load"] = Effect.fn(
    "MoonfoldProjectFileLoader.load",
  )(function* (workspaceRoot) {
    const filePath = path.join(workspaceRoot, MOONFOLD_PROJECT_FILE_NAME);
    const raw = yield* fileSystem.readFileString(filePath).pipe(
      Effect.asSome,
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed(Option.none<string>())
            : logMoonfoldProjectFileLoadError(
                new MoonfoldProjectFileLoadError({
                  operation: "read",
                  workspaceRoot,
                  filePath,
                  cause: error,
                }),
              ).pipe(Effect.as(Option.none<string>())),
      }),
    );
    if (Option.isNone(raw)) {
      return Option.none<MoonfoldProjectFile>();
    }
    return yield* decodeMoonfoldProjectFileJson(raw.value).pipe(
      Effect.asSome,
      Effect.catchTags({
        SchemaError: (error) =>
          logMoonfoldProjectFileLoadError(
            new MoonfoldProjectFileLoadError({
              operation: "decode",
              workspaceRoot,
              filePath,
              cause: error,
            }),
          ).pipe(Effect.as(Option.none<MoonfoldProjectFile>())),
      }),
    );
  });

  return MoonfoldProjectFileLoader.of({ load });
});

export const layer = Layer.effect(MoonfoldProjectFileLoader, make);
