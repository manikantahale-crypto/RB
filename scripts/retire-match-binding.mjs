import pg from "pg";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env") });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Retire platform match binding so Syntra4 can go live on syntra.match.requested
const retired = await pool.query(`
  UPDATE graph_event_bindings
     SET status = 'retired', updated_at = now()
   WHERE event_type = 'syntra.match.requested'
     AND status = 'active'
  RETURNING event_type, graph_key, agent_id::text, status
`);

const active = await pool.query(`
  SELECT event_type, graph_key, agent_id::text, status
    FROM graph_event_bindings
   WHERE event_type = 'syntra.match.requested' AND status = 'active'
`);

console.log(JSON.stringify({ retired: retired.rows, activeMatchBinding: active.rows }, null, 2));
await pool.end();
