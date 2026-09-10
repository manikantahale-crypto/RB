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
  UPDATE authoring.event_bindings b
     SET status = 'retired', updated_at = now()
    FROM authoring.graphs g
   WHERE g.id = b.graph_id
     AND b.event_type = 'syntra.match.requested'
     AND b.status = 'active'
  RETURNING b.event_type, g.graph_key, b.status
`);

const active = await pool.query(`
  SELECT b.event_type, g.graph_key, b.status
    FROM authoring.event_bindings b
    JOIN authoring.graphs g ON g.id = b.graph_id
   WHERE b.event_type = 'syntra.match.requested' AND b.status = 'active'
`);

console.log(JSON.stringify({ retired: retired.rows, activeMatchBinding: active.rows }, null, 2));
await pool.end();
