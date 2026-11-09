/**
 * ComputerUseHelper - the process that reads and operates desktop apps for computer use. On
 * Windows it is one PowerShell process running WINDOWS_HELPER_SCRIPT, started on the first
 * request and stopped when computer use is turned off. Other systems have no helper yet.
 *
 * @module computerUse/ComputerUseHelper
 */
// @effect-diagnostics-next-line nodeBuiltinImport:off -- a long-lived process spoken to over its own stdin and stdout.
import * as NodeChildProcess from "node:child_process";
import * as NodeReadline from "node:readline";

import * as HostProcess from "@moonfold/shared/HostProcess";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";
import { WINDOWS_HELPER_SCRIPT } from "./windowsHelperScript.ts";

/** A request the helper could not do; the message is written for the agent. */
export class ComputerUseHelperError extends Schema.TaggedError<ComputerUseHelperError>()(
  "ComputerUseHelperError",
  { message: Schema.String },
) {}

const encodeRequest = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** Long enough for reading a large window's tree; a hung helper is restarted on the next call. */
const REQUEST_TIMEOUT = Duration.seconds(30);

export class ComputerUseHelper extends Context.Service<
  ComputerUseHelper,
  {
    /** This machine has a helper. */
    readonly supported: boolean;
    readonly request: (
      op: string,
      args?: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<unknown, ComputerUseHelperError>;
    /** Ends the helper process and refuses every request until `resume`. */
    readonly stop: Effect.Effect<void>;
    /** Lets requests start a helper again, after computer use is turned back on. */
    readonly resume: Effect.Effect<void>;
  }
>()("moonfold/computerUse/ComputerUseHelper") {}

interface Running {
  readonly child: NodeChildProcess.ChildProcess;
  readonly pending: Map<number, (response: HelperResponse) => void>;
}

interface HelperResponse {
  readonly id: number | null;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
}

const parseResponse = (line: string): HelperResponse | null => {
  try {
    const value: unknown = JSON.parse(line);
    if (value === null || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    return {
      id: typeof record.id === "number" ? record.id : null,
      ok: record.ok === true,
      result: record.result,
      ...(typeof record.error === "string" ? { error: record.error } : {}),
    };
  } catch {
    return null;
  }
};

const make = Effect.gen(function* () {
  const platform = yield* HostProcess.Platform;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const supported = platform === "win32";
  const startLock = yield* Semaphore.make(1);
  let running: Running | null = null;
  // Set by Stop, so an action that passed its checks just before cannot start a new helper.
  let stopped = false;
  let nextId = 1;

  const failAll = (state: Running, message: string) => {
    for (const resolve of state.pending.values()) resolve({ id: null, ok: false, error: message });
    state.pending.clear();
  };

  const start = startLock
    .withPermit(
      Effect.gen(function* () {
        if (running !== null) return running;
        const directory = path.join(config.baseDir, "tools", "computer-use");
        const scriptPath = path.join(directory, "helper.ps1");
        yield* fileSystem.makeDirectory(directory, { recursive: true });
        yield* fileSystem.writeFileString(scriptPath, WINDOWS_HELPER_SCRIPT);
        const child = NodeChildProcess.spawn(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
          { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
        );
        const state: Running = { child, pending: new Map() };
        NodeReadline.createInterface({ input: child.stdout }).on("line", (line) => {
          const response = parseResponse(line);
          if (response === null || response.id === null) return;
          const resolve = state.pending.get(response.id);
          state.pending.delete(response.id);
          resolve?.(response);
        });
        // Drained so a chatty error stream can never block the helper.
        child.stderr.on("data", () => undefined);
        child.on("exit", () => {
          if (running === state) running = null;
          failAll(state, "The computer-use helper stopped. Try again.");
        });
        child.on("error", () => {
          if (running === state) running = null;
          failAll(state, "The computer-use helper could not start.");
        });
        running = state;
        return state;
      }),
    )
    .pipe(
      Effect.mapError(
        () => new ComputerUseHelperError({ message: "Could not prepare the computer-use helper." }),
      ),
    );

  const request: ComputerUseHelper["Service"]["request"] = Effect.fn("ComputerUseHelper.request")(
    function* (op, args = {}) {
      if (!supported) {
        return yield* new ComputerUseHelperError({
          message: "Computer use is not available on this operating system yet.",
        });
      }
      if (stopped) {
        return yield* new ComputerUseHelperError({ message: "Computer use was stopped." });
      }
      const state = yield* start;
      const id = nextId++;
      const response = yield* Effect.callback<HelperResponse>((resume) => {
        state.pending.set(id, (value) => resume(Effect.succeed(value)));
        state.child.stdin?.write(`${encodeRequest({ ...args, id, op })}\n`);
        return Effect.sync(() => state.pending.delete(id));
      }).pipe(
        Effect.timeoutOption(REQUEST_TIMEOUT),
        Effect.flatMap((result) =>
          result._tag === "Some"
            ? Effect.succeed(result.value)
            : // A helper that stops answering is replaced on the next request.
              Effect.sync(() => {
                state.child.kill();
                return {
                  id,
                  ok: false,
                  error: "The app did not respond in time. Try again.",
                } satisfies HelperResponse;
              }),
        ),
      );
      if (!response.ok) {
        return yield* new ComputerUseHelperError({
          message: response.error ?? "The computer-use helper failed.",
        });
      }
      return response.result;
    },
  );

  const stop = Effect.sync(() => {
    stopped = true;
    const state = running;
    running = null;
    if (state !== null) {
      failAll(state, "Computer use was stopped.");
      state.child.kill();
    }
  });

  yield* Effect.addFinalizer(() => stop);

  const resume = Effect.sync(() => {
    stopped = false;
  });

  return ComputerUseHelper.of({ supported, request, stop, resume });
});

export const layer = Layer.effect(ComputerUseHelper, make);
