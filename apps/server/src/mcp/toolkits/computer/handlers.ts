import { OrchestratorMcpFailure } from "@moonfold/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as ComputerUseService from "../../../computerUse/ComputerUseService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import {
  ComputerScreenshotToolkit,
  ComputerStandardToolkit,
  type ComputerToolkit,
} from "./tools.ts";

const refused = (error: ComputerUseService.ComputerUseRefused) =>
  new OrchestratorMcpFailure({ code: "capability_denied", message: error.message });

/** The calling thread: computer use belongs to agents Moonfold launched in a thread. */
const callerThread = Effect.gen(function* () {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const { thread } = yield* McpInvocationContext.requireThreadScope(scope, "computer use");
  return thread.threadId;
});

const act = Effect.fn("act")(function* (
  window: string,
  action: "screenshot" | "read" | "click" | "type" | "key" | "scroll",
  detail: string,
  args: Readonly<Record<string, unknown>>,
) {
  const threadId = yield* callerThread;
  const computer = yield* ComputerUseService.ComputerUseService;
  return yield* computer
    .act({ threadId, window }, action, detail, args)
    .pipe(Effect.mapError(refused));
});

const done = (message: string) => () => ({ message });

const Screenshot = Schema.Struct({ png: Schema.String, width: Schema.Int, height: Schema.Int });
const decodeScreenshot = Schema.decodeUnknownEffect(Screenshot);
const ReadResult = Schema.Struct({
  elements: Schema.Array(Schema.Unknown),
  truncated: Schema.Boolean,
});
const decodeRead = Schema.decodeUnknownEffect(ReadResult);
const malformed = () =>
  new OrchestratorMcpFailure({
    code: "orchestration_error",
    message: "The computer-use helper answered with something unexpected.",
  });

const handlers = {
  computer_list_apps: McpToolAccess.actsAsCaller(() =>
    Effect.gen(function* () {
      const threadId = yield* callerThread;
      const computer = yield* ComputerUseService.ComputerUseService;
      const apps = yield* computer.listApps(threadId).pipe(Effect.mapError(refused));
      return {
        apps: apps.map(({ window, app, title, width, height, minimized, approved }) => ({
          window,
          app,
          title,
          width,
          height,
          minimized,
          approved,
        })),
      };
    }),
  ),
  computer_screenshot: McpToolAccess.actsAsCaller((input) =>
    act(input.window, "screenshot", "screenshot", {}).pipe(
      Effect.flatMap((result) => decodeScreenshot(result).pipe(Effect.mapError(malformed))),
      Effect.map((shot) => ({
        window: input.window,
        screenshot: {
          mimeType: "image/png" as const,
          data: shot.png,
          width: shot.width,
          height: shot.height,
        },
      })),
    ),
  ),
  computer_read: McpToolAccess.actsAsCaller((input) =>
    act(
      input.window,
      "read",
      `up to ${input.maxElements ?? 300} elements`,
      input.maxElements === undefined ? {} : { maxElements: input.maxElements },
    ).pipe(Effect.flatMap((result) => decodeRead(result).pipe(Effect.mapError(malformed)))),
  ),
  computer_click: McpToolAccess.actsAsCaller((input) =>
    act(
      input.window,
      "click",
      `${input.double ? "double " : ""}${input.button ?? "left"} click at ${input.x},${input.y}`,
      { x: input.x, y: input.y, right: input.button === "right", double: input.double === true },
    ).pipe(Effect.map(done("Clicked."))),
  ),
  computer_type: McpToolAccess.actsAsCaller((input) =>
    // The log keeps how much was typed, never what.
    act(input.window, "type", `${input.text.length} characters`, { text: input.text }).pipe(
      Effect.map(done("Typed.")),
    ),
  ),
  computer_key: McpToolAccess.actsAsCaller((input) =>
    // A single character pressed alone is logged as a count, like typed text.
    act(input.window, "key", /^\S$/.test(input.keys.trim()) ? "1 key" : input.keys, {
      keys: input.keys,
    }).pipe(Effect.map(done("Pressed."))),
  ),
  computer_scroll: McpToolAccess.actsAsCaller((input) =>
    act(input.window, "scroll", `${input.clicks} at ${input.x},${input.y}`, {
      x: input.x,
      y: input.y,
      clicks: input.clicks,
    }).pipe(Effect.map(done("Scrolled."))),
  ),
} satisfies McpToolAccess.Handlers<typeof ComputerToolkit.tools>;

const { computer_screenshot, ...standardHandlers } = handlers;

export const layerStandard = McpToolAccess.toLayer(ComputerStandardToolkit, standardHandlers);

export const layerScreenshot = McpToolAccess.toLayer(ComputerScreenshotToolkit, {
  computer_screenshot,
});
