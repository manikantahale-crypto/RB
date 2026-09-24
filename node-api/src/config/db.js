const { Pool } = require("pg");
const { canonicalPoolOpts } = require("./canonicalDb");
const env = require("./env");

const poolConfig = canonicalPoolOpts(env.DATABASE_URL, "node-api", {
  max: 2,
  idleTimeoutMillis: 8000,
  connectionTimeoutMillis: 15000,
  searchPath: ["syntra", "public"],
});

const pool = new Pool(poolConfig);


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
