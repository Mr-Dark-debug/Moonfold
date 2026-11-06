// @effect-diagnostics nodeBuiltinImport:off - Compares the committed schema file on disk.
import * as NodeFS from "node:fs";

import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  buildMoonfoldProjectFileJsonSchema,
  MoonfoldProjectFileFromJson,
  parseMoonfoldProjectFile,
} from "./moonfoldProjectFile.ts";

const decodeJson = Schema.decodeUnknownSync(MoonfoldProjectFileFromJson);

describe("buildMoonfoldProjectFileJsonSchema", () => {
  it("matches the committed schemas/moonfold.json", () => {
    const committed = NodeFS.readFileSync(
      new URL("../../../schemas/moonfold.json", import.meta.url),
      "utf8",
    );
    // Regenerate with: node scripts/export-project-schema.ts
    expect(JSON.parse(committed)).toEqual(buildMoonfoldProjectFileJsonSchema());
  });

  it("emits a draft 2020-12 schema with the published $id", () => {
    const schema = buildMoonfoldProjectFileJsonSchema();

    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.$id).toBe(
      "https://raw.githubusercontent.com/Mr-Dark-debug/Moonfold/main/schemas/moonfold.json",
    );
  });
});

describe("MoonfoldProjectFileFromJson", () => {
  it("decodes lenient JSONC with comments and trailing commas", () => {
    const decoded = decodeJson(`{
      // team scripts
      "iconPath": "assets/logo.svg",
      "scripts": [
        { "name": "Dev", "command": "pnpm dev", "stopOnSettle": true, },
      ],
    }`);

    expect(decoded.iconPath).toBe("assets/logo.svg");
    expect(decoded.scripts?.[0]).toEqual({ name: "Dev", command: "pnpm dev", stopOnSettle: true });
  });
});

describe("parseMoonfoldProjectFile", () => {
  it("reads project defaults from JSONC with a URL in a block comment", () => {
    expect(
      parseMoonfoldProjectFile(`{
        /* See https://t3.codes/schema/moonfold.json */
        "defaultThreadEnvMode": "worktree"
      }`),
    ).toEqual({ defaultThreadEnvMode: "worktree" });
  });
});
