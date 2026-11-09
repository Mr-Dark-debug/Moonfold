import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { MoonfoldProjectFile, MOONFOLD_PROJECT_FILE_SCHEMA_URL } from "@moonfold/contracts";

import { fromLenientJson } from "./schemaJson.ts";

export const MoonfoldProjectFileFromJson = fromLenientJson(MoonfoldProjectFile);

const decodeMoonfoldProjectFile = Schema.decodeExit(MoonfoldProjectFileFromJson);

export function parseMoonfoldProjectFile(contents: string): MoonfoldProjectFile | null {
  const decoded = decodeMoonfoldProjectFile(contents);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

/**
 * Build the publishable JSON Schema document for `moonfold.json` (draft 2020-12).
 *
 * Committed at `schemas/moonfold.json` and published at {@link MOONFOLD_PROJECT_FILE_SCHEMA_URL}
 * so editors get LSP support via a `$schema` reference. The shared test keeps the two in sync.
 */
export function buildMoonfoldProjectFileJsonSchema(): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(MoonfoldProjectFile, { onExcessProperty: "error" });
  const jsonSchema: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: MOONFOLD_PROJECT_FILE_SCHEMA_URL,
    ...document.schema,
  };
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    jsonSchema.$defs = document.definitions;
  }
  return jsonSchema;
}
