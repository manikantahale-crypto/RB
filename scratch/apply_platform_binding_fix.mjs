import pg from 'pg';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const line = env.split(/\r?\n/).find(l => l.startsWith('DATABASE_URL='));
const dbUrl = line.slice('DATABASE_URL='.length).trim();
const pool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Retire stale JD binding
    const r1 = await client.query(`
      UPDATE authoring.event_bindings
      SET status = 'retired', updated_at = now()
      WHERE graph_id IN (
        SELECT id FROM authoring.graphs WHERE graph_key = 'syntra.jd.workflow'
      ) AND status = 'active'
      RETURNING id, event_type
    `);
    console.log("Retired stale JD binding:", r1.rows);

    // 2. Step down dangling retired workflows that have no active bindings
    const r2 = await client.query(`
      UPDATE authoring.graph_versions
      SET status = 'retired'
      WHERE graph_id IN (
        SELECT id FROM authoring.graphs
        WHERE graph_key IN ('syntra.run.retry.workflow', 'syntra.shortlist.workflow')
      ) AND status = 'live'
      RETURNING version, graph_id
    `);
    console.log("Stepped down dangling live versions:", r2.rows);

    const r3 = await client.query(`
      UPDATE authoring.graphs
      SET status = 'retired', updated_at = now()
      WHERE graph_key IN ('syntra.run.retry.workflow', 'syntra.shortlist.workflow') AND status = 'active'
      RETURNING graph_key, status
    `);
    console.log("Retired graphs:", r3.rows);

    await client.query("COMMIT");
    console.log("Transaction committed successfully.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed, rolled back:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
