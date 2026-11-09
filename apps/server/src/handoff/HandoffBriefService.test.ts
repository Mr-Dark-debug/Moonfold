import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type OrchestrationV2ProviderCapabilities,
} from "@moonfold/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { HandoffBriefService, layer as briefLayer } from "./HandoffBriefService.ts";

const drivers: Record<string, string> = { codex: "codex", claudeAgent: "claudeAgent" };

const testLayer = briefLayer.pipe(
  Layer.provideMerge(
    Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({
      list: () => Effect.succeed([]),
      getMetadata: (instanceId) =>
        Effect.succeed({
          driver: ProviderDriverKind.make(drivers[instanceId] ?? "codex"),
          continuationKey: instanceId,
          enabled: true,
          capabilities: {} as OrchestrationV2ProviderCapabilities,
        }),
    } satisfies Partial<ProviderAdapterRegistry.ProviderAdapterRegistryV2["Service"]>),
  ),
  Layer.provideMerge(GitVcsDriver.layer),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "handoff-brief-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const emptyProjection = {
  thread: { activeProviderThreadId: null },
  turnItems: [],
  runtimeRequests: [],
  providerThreads: [],
};

const codex = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-luna" };
const claude = { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-sonnet-5-5" };

describe("HandoffBriefService", () => {
  it.effect("reads the workspace's git state and instructions into the brief", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const git = yield* GitVcsDriver.GitVcsDriver;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "handoff-brief-repo-" });
      const run = (args: ReadonlyArray<string>) => git.execute({ operation: "test", cwd, args });
      yield* run(["init", "--quiet"]);
      yield* run(["config", "user.email", "test@example.test"]);
      yield* run(["config", "user.name", "Test"]);
      yield* fs.writeFileString(path.join(cwd, "AGENTS.md"), "Use tabs.\n");
      yield* fs.writeFileString(path.join(cwd, "app.js"), "one\n");
      yield* run(["add", "."]);
      yield* run(["commit", "--quiet", "-m", "start"]);
      yield* fs.writeFileString(path.join(cwd, "app.js"), "one\ntwo\n");
      yield* fs.writeFileString(path.join(cwd, "new.js"), "new\n");

      const brief = yield* (yield* HandoffBriefService).build({
        projection: emptyProjection,
        cwd,
        from: codex,
        to: claude,
        reason: "manual",
      });

      expect(brief.text).toContain("The user moved the task from Codex (gpt-5.6-luna) to you.");
      expect(brief.text).toContain("You are Claude (claude-sonnet-5-5).");
      expect(brief.text).toContain(" M app.js\n?? new.js");
      expect(brief.text).toContain("app.js | 1 +");
      expect(brief.text).toContain("## Project instructions (AGENTS.md)\n```\nUse tabs.\n```");
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("leaves git out when the workspace is not a repository", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "handoff-brief-plain-" });
      const brief = yield* (yield* HandoffBriefService).build({
        projection: emptyProjection,
        cwd,
        from: codex,
        to: claude,
        reason: "usage_limit",
      });
      expect(brief.text).toContain("The workspace is not a git repository");
      expect(brief.text).not.toContain("## Project instructions");
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );
});
