import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // One row per run of a scheduled task. `message_id` is the prompt the run sent, which is how
  // its orchestration run is found to follow the agent's outcome.
  yield* sql`
    CREATE TABLE IF NOT EXISTS scheduled_task_runs (
      run_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      trigger TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      thread_id TEXT,
      message_id TEXT,
      orchestration_run_id TEXT,
      error TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_task_started
    ON scheduled_task_runs(task_id, started_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_open
    ON scheduled_task_runs(status)
    WHERE status = 'working'
  `;

  // When a task's runs notify: every run, failures only, or never.
  yield* sql`
    ALTER TABLE scheduled_tasks ADD COLUMN notify_policy TEXT NOT NULL DEFAULT 'all'
  `;
});
