import pg from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_MIGRATOR_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  const q = await pool.query(
    `SELECT name, policy, retry_limit, expire_seconds, retention_seconds,
            dead_letter
       FROM pgboss.queue
      WHERE name IN ('orchestration.ingress','module.syntra.jd','orchestration.dispatch')
      ORDER BY name`,
  );
  console.log("queues:");
  console.table(q.rows);

  // recent ingress completions
  const jobs = await pool.query(
    `SELECT id, state, data->>'event_type' AS et,
            created_on, started_on, completed_on,
            EXTRACT(EPOCH FROM (completed_on - created_on)) AS create_to_done_s,
            EXTRACT(EPOCH FROM (completed_on - started_on)) AS start_to_done_s
       FROM pgboss.job
      WHERE name = 'orchestration.ingress'
        AND data->>'event_type' = 'syntra.jd.normalized'
      ORDER BY created_on DESC
      LIMIT 5`,
  );
  console.log("recent normalized ingress jobs:");
  console.table(jobs.rows);

  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
