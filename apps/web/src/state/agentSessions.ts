import { WS_METHODS } from "@moonfold/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@moonfold/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

export const agentSessionScan = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:agent-sessions:scan",
  tag: WS_METHODS.agentSessionsScan,
  staleTimeMs: 30_000,
  idleTtlMs: 5 * 60_000,
});

export const agentSessionImport = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:agent-sessions:import",
  tag: WS_METHODS.agentSessionsImport,
});

export const agentSessionList = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:agent-sessions:list",
  tag: WS_METHODS.agentSessionsList,
});

export const agentSessionLookup = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:agent-sessions:lookup",
  tag: WS_METHODS.agentSessionsLookup,
});

export const agentSessionImportSession = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:agent-sessions:import-session",
  tag: WS_METHODS.agentSessionsImportSession,
});
