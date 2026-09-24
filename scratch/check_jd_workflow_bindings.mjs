import pg from 'pg';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const line = env.split(/\r?\n/).find(l => l.startsWith('DATABASE_URL='));
const dbUrl = line.slice('DATABASE_URL='.length).trim();
const pool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function run() {
  const r = await pool.query(`
    SELECT b.id, b.event_type, g.graph_key, b.status
    FROM authoring.event_bindings b
    JOIN authoring.graphs g ON g.id = b.graph_id
    WHERE g.graph_key = 'syntra.jd.workflow'
  `);
  console.log("All bindings for syntra.jd.workflow:");
  console.table(r.rows);
  await pool.end();
}

run();
