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
    `SELECT name, state, count(*)::int AS n
       FROM pgboss.job
      WHERE name IN (
        'orchestration.ingress',
        'orchestration.dispatch',
        'module.syntra.jd'
      )
      GROUP BY name, state
      ORDER BY name, state`,
  );
  console.log("pgboss queues:");
  console.table(q.rows);

  const recent = await pool.query(
    `SELECT name, state, data->>'event_type' AS event_type,
            data->>'event_id' AS event_id, created_on, completed_on
       FROM pgboss.job
      WHERE data->>'event_id' = $1
      ORDER BY created_on`,
    ["e17d1516-fb50-4bf4-803d-07836beca5c0"],
  );
  console.log("jobs for syntra.jd.normalized event:");
  console.table(recent.rows);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
