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
  const r = await pool.query(
    `SELECT id, name, state, output, data
       FROM pgboss.job
      WHERE data->>'event_id' = $1`,
    [eventId],
  );
  console.log(JSON.stringify(r.rows, null, 2));
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
