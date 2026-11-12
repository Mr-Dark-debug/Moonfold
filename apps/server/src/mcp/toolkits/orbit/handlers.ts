import { type OrbitRole, OrchestratorMcpFailure } from "@moonfold/contracts";
import * as Effect from "effect/Effect";

import * as OrbitService from "../../../orbit/OrbitService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { loadCaller } from "../../threadAccess.ts";
import { OrbitToolkit } from "./tools.ts";

const refuse = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

/**
 * The calling thread's crew role, checked against what the tool allows. This is the boundary that
 * keeps a scout from writing the backlog and a builder from reading public posts (D-70).
 */
const crewCaller = Effect.fn("orbit.crewCaller")(function* (
  allowed: ReadonlyArray<OrbitRole> | "any",
) {
  const { caller } = yield* loadCaller();
  if (caller === undefined) return yield* refuse("Orbit's tools work only inside a crew run.");
  const orbit = yield* OrbitService.OrbitService;
  const role = yield* orbit
    .roleOf(caller.id, caller.projectId)
    .pipe(Effect.mapError((error) => refuse(error.message)));
  if (role === null) return yield* refuse("This thread is not an Orbit crew run.");
  if (allowed !== "any" && !allowed.includes(role)) {
    return yield* refuse(`The ${role} may not use this tool.`);
  }
  return { orbit, role, threadId: caller.id, projectId: caller.projectId };
});

const toFailure = (error: { readonly message: string }) => refuse(error.message);

export const layer = McpToolAccess.toLayer(OrbitToolkit, {
  orbit_brief: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const { orbit, role, projectId } = yield* crewCaller("any");
      return { brief: yield* orbit.brief(projectId, role).pipe(Effect.mapError(toFailure)) };
    }),
  ),
  orbit_read: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const { orbit, role, projectId } = yield* crewCaller(["scout", "sentinel"]);
      const text =
        role === "scout"
          ? yield* orbit.readChannels(projectId).pipe(Effect.mapError(toFailure))
          : yield* orbit.securityScan(projectId).pipe(Effect.mapError(toFailure));
      return { text };
    }),
  ),
  orbit_signals_add: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { orbit, threadId, projectId } = yield* crewCaller(["scout"]);
      yield* Effect.forEach(input.signals, (signal) =>
        orbit.addSignal(projectId, threadId, signal).pipe(Effect.mapError(toFailure)),
      );
      return { saved: input.signals.length };
    }),
  ),
  orbit_backlog_set: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { orbit, threadId, projectId } = yield* crewCaller(["planner"]);
      const saved = yield* orbit
        .setBacklog(projectId, threadId, input.backlog)
        .pipe(Effect.mapError(toFailure));
      return { saved };
    }),
  ),
  orbit_backlog_take: McpToolAccess.actsAsCaller(() =>
    Effect.gen(function* () {
      const { orbit, threadId, projectId } = yield* crewCaller(["builder"]);
      const item = yield* orbit.takeBacklog(projectId, threadId).pipe(Effect.mapError(toFailure));
      return { item: item === null ? null : { id: item.id, title: item.title, body: item.body } };
    }),
  ),
  orbit_draft_add: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { orbit, threadId, projectId } = yield* crewCaller(["herald"]);
      return {
        id: yield* orbit.addDraft(projectId, threadId, input).pipe(Effect.mapError(toFailure)),
      };
    }),
  ),
  orbit_report: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { orbit, role, threadId, projectId } = yield* crewCaller("any");
      return {
        id: yield* orbit.report(projectId, role, threadId, input).pipe(Effect.mapError(toFailure)),
      };
    }),
  ),
});
