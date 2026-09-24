import pg from 'pg';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const line = env.split(/\r?\n/).find(l => l.startsWith('DATABASE_URL='));
const dbUrl = line.slice('DATABASE_URL='.length).trim();
const pool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function run() {
  const b = await pool.query(`
    SELECT b.id, b.event_type, g.graph_key, b.status, b.queue_key
    FROM authoring.event_bindings b
    JOIN authoring.graphs g ON g.id = b.graph_id
    ORDER BY b.event_type
  `);
  console.log('BINDINGS:');
  console.table(b.rows);

  const g = await pool.query(`
    SELECT g.id, g.graph_key, g.status as graph_status, v.version, v.status as version_status
    FROM authoring.graphs g
    LEFT JOIN authoring.graph_versions v ON g.id = v.graph_id
    ORDER BY g.graph_key, v.version
  `);
  console.log('GRAPHS AND VERSIONS:');
  console.table(g.rows);

  await pool.end();
}

run().catch(console.error);
