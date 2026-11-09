import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // What agents may do on each site through the browser tools. The row for site '*' holds the
  // defaults for sites without a rule of their own.
  yield* sql`
    CREATE TABLE IF NOT EXISTS browser_site_rules (
      site TEXT PRIMARY KEY,
      browse TEXT NOT NULL,
      upload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
});
