import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Single-row settings such as whether computer use is on.
  yield* sql`
    CREATE TABLE IF NOT EXISTS computer_use_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `;

  // Apps the user always allows agents to use, by executable name.
  yield* sql`
    CREATE TABLE IF NOT EXISTS computer_use_apps (
      app TEXT PRIMARY KEY,
      added_at TEXT NOT NULL
    )
  `;

  // Every read and action an agent took, newest last. Typed text is never stored.
  yield* sql`
    CREATE TABLE IF NOT EXISTS computer_use_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      app TEXT,
      action TEXT NOT NULL,
      detail TEXT NOT NULL,
      outcome TEXT NOT NULL,
      error TEXT,
      at TEXT NOT NULL
    )
  `;
});
