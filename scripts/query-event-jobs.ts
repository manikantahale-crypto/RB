import pg from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_MIGRATOR_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  const eventId = process.argv[2]!;
  const recent = await pool.query(
    `SELECT name, state, data->>'event_type' AS event_type,
            data->>'event_id' AS event_id,
            data->>'__graphKey' AS graph_key,
            created_on, started_on, completed_on,
            output
       FROM pgboss.job
      WHERE data->>'event_id' = $1
      ORDER BY created_on`,
    [eventId],
  );
  console.table(
    recent.rows.map((r) => ({
      name: r.name,
      state: r.state,
      event_type: r.event_type,
      graph_key: r.graph_key,
      created_on: r.created_on,
      completed_on: r.completed_on,
    })),
  );
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
