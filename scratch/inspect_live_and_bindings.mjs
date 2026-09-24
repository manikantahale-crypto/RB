import pg from 'pg';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const line = env.split(/\r?\n/).find(l => l.startsWith('DATABASE_URL='));
const dbUrl = line.slice('DATABASE_URL='.length).trim();
const pool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function run() {
  const q = await pool.query(`
    SELECT g.graph_key, g.status as graph_status, v.version, v.status as version_status,
           (SELECT count(*) FROM authoring.event_bindings b WHERE b.graph_id = g.id AND b.status = 'active') as active_bindings_count
    FROM authoring.graphs g
    JOIN authoring.graph_versions v ON g.id = v.graph_id AND v.status = 'live'
    ORDER BY g.graph_key
  `);
  console.log("LIVE VERSIONS:");
  console.table(q.rows);

  const b = await pool.query(`
    SELECT b.id, b.event_type, g.graph_key, b.status as binding_status,
           (SELECT count(*) FROM authoring.graph_versions v WHERE v.graph_id = g.id AND v.status = 'live') as live_versions_count
    FROM authoring.event_bindings b
    JOIN authoring.graphs g ON g.id = b.graph_id
    WHERE b.status = 'active'
    ORDER BY g.graph_key
  `);
  console.log("ACTIVE BINDINGS:");
  console.table(b.rows);

  await pool.end();
}

run().catch(console.error);
