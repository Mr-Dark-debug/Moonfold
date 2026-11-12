import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // One row per project with Orbit set up (D-70): the owner's mission, settings and stop switch.
  yield* sql`
    CREATE TABLE IF NOT EXISTS orbit_projects (
      project_id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      mission TEXT NOT NULL,
      paused INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  // The scheduled task that runs each crew role.
  yield* sql`
    CREATE TABLE IF NOT EXISTS orbit_crew (
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      task_id TEXT NOT NULL,
      PRIMARY KEY (project_id, role)
    )
  `;

  // Signals, backlog, findings, questions and drafts.
  yield* sql`
    CREATE TABLE IF NOT EXISTS orbit_items (
      item_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      author TEXT NOT NULL,
      url TEXT,
      source TEXT,
      rank REAL NOT NULL,
      thread_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS orbit_items_project ON orbit_items (project_id, kind, status)`;

  // Append-only: nothing updates or deletes a row.
  yield* sql`
    CREATE TABLE IF NOT EXISTS orbit_audit (
      audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      at TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS orbit_audit_project ON orbit_audit (project_id, audit_id)`;
});
