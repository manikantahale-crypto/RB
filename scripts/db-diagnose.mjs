import pg from "pg";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env") });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const recentEvents = await pool.query(`
  SELECT event_type, producer, occurred_at,
         published_at IS NOT NULL AS published
    FROM event_outbox
   ORDER BY occurred_at DESC
   LIMIT 10
`);

const matchBindings = await pool.query(`
  SELECT event_type, graph_key, agent_id::text, status, updated_at
    FROM graph_event_bindings
   WHERE event_type = 'syntra.match.requested'
   ORDER BY updated_at DESC
   LIMIT 5
`);

let flyway = [];
try {
  const r = await pool.query(`
    SELECT version, description, installed_on::text
      FROM flyway_schema_history
     ORDER BY installed_rank DESC
     LIMIT 8
  `);
  flyway = r.rows;
} catch (e) {
  flyway = [{ error: e.message }];
}

const recentJobs = await pool.query(`
  SELECT j.id::text,
         j.title,
         j.processing_status,
         j.status,
         j.created_at,
         (SELECT COUNT(*)::int FROM syntra.matches m WHERE m.job_id = j.id) AS match_count,
         (SELECT COUNT(*)::int
            FROM syntra.resumes r
            JOIN syntra.candidates c ON r.candidate_id = c.id
           WHERE c.created_by = j.created_by
             AND c.created_by IS NOT NULL
             AND r.is_current
             AND r.processed_at IS NOT NULL
             AND r.embedding IS NOT NULL) AS eligible_resumes
    FROM syntra.jobs j
   ORDER BY j.created_at DESC
   LIMIT 5
`).catch((e) => ({ rows: [{ error: e.message }] }));

const activeBindings = await pool.query(`
  SELECT event_type, graph_key, agent_id::text, status
    FROM graph_event_bindings
   WHERE status = 'active'
   ORDER BY event_type
`).catch((e) => ({ rows: [{ error: e.message }] }));

console.log(
  JSON.stringify(
    {
      recentEvents: recentEvents.rows,
      matchBindings: matchBindings.rows,
      activeBindings: activeBindings.rows,
      flywayLatest: flyway,
      recentJobs: recentJobs.rows,
    },
    null,
    2,
  ),
);

await pool.end();
