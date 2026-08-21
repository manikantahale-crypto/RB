const { Pool } = require("pg");
const env = require("./env");

// Supabase session pooler caps ~15 clients TOTAL across all apps/processes.
// Keep this small: Node HTTP pool + pg-boss pool + Python must fit under the cap.
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase requires SSL
  max: 3,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 15000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  searchPath: ["syntra", "public"], // Officially supported pg property
});


// Idle clients can drop (Supabase/proxy). Log and let the pool replace them —
// do NOT let this become an unhandled 'error' that kills the process.
pool.on("error", (err) => {
  console.error("[db] unexpected pool error (idle client):", err.message);
});

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection may already be gone */
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
