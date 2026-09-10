import pg from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_MIGRATOR_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  const corr = process.argv[2]!;
  const r = await pool.query(
    `SELECT event_id::text, event_type, published_at IS NOT NULL AS published
       FROM orch.event_outbox WHERE correlation_id = $1::uuid ORDER BY occurred_at`,
    [corr],
  );
  console.table(r.rows);
  const runs = await pool.query(
    `SELECT id::text, graph_key, status, trigger_event_id::text
       FROM orch.runs
      WHERE trigger_event_id IN (
        SELECT event_id FROM orch.event_outbox WHERE correlation_id = $1::uuid
      )
      ORDER BY started_at`,
    [corr],
  );
  console.table(runs.rows);
  const steps = await pool.query(
    `SELECT s.seq, s.node, s.status, s.latency_ms, r.graph_key
       FROM orch.steps s JOIN orch.runs r ON r.id = s.run_id
      WHERE r.trigger_event_id IN (
        SELECT event_id FROM orch.event_outbox WHERE correlation_id = $1::uuid
      )
      ORDER BY r.started_at, s.seq`,
    [corr],
  );
  console.table(steps.rows);
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
