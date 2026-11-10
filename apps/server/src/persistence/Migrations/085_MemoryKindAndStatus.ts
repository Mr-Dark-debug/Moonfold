import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Environment notes sit beside preferences; a suggested memory waits for the user (D-68).
  yield* sql`ALTER TABLE memories ADD COLUMN kind TEXT NOT NULL DEFAULT 'preference'`;
  yield* sql`ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`;
});
