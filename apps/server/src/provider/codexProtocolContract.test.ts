// @effect-diagnostics nodeBuiltinImport:off - Reads the pinned protocol schema and Codex sources from disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

/**
 * Contract between Moonfold's Codex integration and the pinned Codex CLI's app-server schema in
 * docs/protocol/codex-json (docs/PROTOCOL.md). Every method Moonfold sends and every server
 * message it handles must exist there, and none may be experimental or under development
 * unless listed below with the reason it is safe.
 */
const repoRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../../../..",
);
const schemaDir = NodePath.join(repoRoot, "docs/protocol/codex-json");
const sourceDir = NodePath.join(repoRoot, "apps/server/src");

/** Methods newer than the pinned CLI, each with why calling it is safe on the pinned version. */
const NEWER_THAN_PIN: Readonly<Record<string, string>> = {
  "thread/backgroundTerminals/list":
    "Only reached for background terminals, which only newer Codex versions create.",
  "thread/backgroundTerminals/terminate":
    "Only reached for background terminals, which only newer Codex versions create.",
};

/**
 * Experimental server messages Moonfold handles. The server only sends them because Moonfold opts
 * in with `experimentalApi`; handling one calls nothing under development, and an older or newer
 * server that never sends it leaves the feature idle.
 */
const HANDLED_EXPERIMENTAL: Readonly<Record<string, string>> = {
  "item/plan/delta": "Streams plan-mode text; without it the final plan item still arrives.",
  "item/tool/requestUserInput":
    "Tool questions to the user; without it the tool runs without asking.",
};

interface SchemaVariant {
  readonly description?: string;
  readonly properties?: { readonly method?: { readonly enum?: ReadonlyArray<string> } };
}

function readMethods(file: string): ReadonlyMap<string, SchemaVariant> {
  const document = JSON.parse(NodeFS.readFileSync(NodePath.join(schemaDir, file), "utf8")) as {
    readonly oneOf: ReadonlyArray<SchemaVariant>;
  };
  const methods = new Map<string, SchemaVariant>();
  for (const variant of document.oneOf) {
    const method = variant.properties?.method?.enum?.[0];
    if (method) methods.set(method, variant);
  }
  return methods;
}

function codexSources(directory: string): ReadonlyArray<string> {
  const found: Array<string> = [];
  for (const entry of NodeFS.readdirSync(directory, { withFileTypes: true })) {
    const path = NodePath.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...codexSources(path));
    else if (/^codex.*\.ts$/i.test(entry.name) && !/\.test(kit)?\.ts$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

/** Method names passed as the first argument of `call(...)` across the Codex sources. */
function usedMethods(call: string): ReadonlySet<string> {
  const pattern = new RegExp(`\\b${call}\\(\\s*"([^"]+)"`, "g");
  const methods = new Set<string>();
  for (const file of codexSources(sourceDir)) {
    for (const match of NodeFS.readFileSync(file, "utf8").matchAll(pattern)) {
      methods.add(match[1]!);
    }
  }
  return methods;
}

const UNSTABLE = /EXPERIMENTAL|\[UNSTABLE\]|under development/i;

describe("Codex app-server protocol contract (pinned CLI schema)", () => {
  const directions = [
    { call: "request", schema: "ClientRequest.json" },
    { call: "notify", schema: "ClientNotification.json" },
    { call: "handleServerNotification", schema: "ServerNotification.json" },
    { call: "handleServerRequest", schema: "ServerRequest.json" },
  ] as const;

  it.each(directions)("uses only $schema methods that exist in the pinned schema", (direction) => {
    const known = readMethods(direction.schema);
    const used = usedMethods(direction.call);
    expect(used.size).toBeGreaterThan(0);
    const missing = [...used].filter((method) => !known.has(method) && !(method in NEWER_THAN_PIN));
    expect(missing).toEqual([]);
  });

  it.each(directions)(
    "uses no $schema method the pinned schema marks unstable, unless reviewed",
    (direction) => {
      const known = readMethods(direction.schema);
      const unstable = [...usedMethods(direction.call)].filter(
        (method) =>
          UNSTABLE.test(known.get(method)?.description ?? "") && !(method in HANDLED_EXPERIMENTAL),
      );
      expect(unstable).toEqual([]);
    },
  );

  it("reviews experimental messages only for what Moonfold receives, never for what it sends", () => {
    const sent = new Set([...usedMethods("request"), ...usedMethods("notify")]);
    expect(Object.keys(HANDLED_EXPERIMENTAL).filter((method) => sent.has(method))).toEqual([]);
  });

  it("keeps the newer-than-pin allowance limited to methods still missing from the pin", () => {
    const known = readMethods("ClientRequest.json");
    expect(Object.keys(NEWER_THAN_PIN).filter((method) => known.has(method))).toEqual([]);
  });
});
