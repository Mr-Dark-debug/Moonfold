import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // A null project_id applies to every project.
  yield* sql`
    CREATE TABLE IF NOT EXISTS memories (
      memory_id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      project_id TEXT,
      source TEXT NOT NULL,
      thread_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  // Single-row settings such as whether memories are on.
  yield* sql`
    CREATE TABLE IF NOT EXISTS memory_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `;

  // Threads the user turned memories off for.
  yield* sql`
    CREATE TABLE IF NOT EXISTS memory_thread_opt_outs (
      thread_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    )
  `;
});
