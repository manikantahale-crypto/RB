/** Emit a test syntra.jd.parsed event for the latest job — verifies outbox → worker path. */
import pg from "pg";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

config({ path: resolve(process.cwd(), ".env") });

const require = createRequire(import.meta.url);
const platformEvents = require("../node-api/src/services/platformEvents.service.js");

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const { rows } = await pool.query(`
  SELECT id::text FROM syntra.jobs ORDER BY created_at DESC LIMIT 1
`);
const jobId = rows[0]?.id;
if (!jobId) {
  console.error("No jobs in syntra.jobs — upload a JD first.");
  process.exit(1);
}

const row = await platformEvents.publishJdParsed({ jobId });
console.log("Published syntra.jd.parsed for job", jobId, row);
console.log("Watch orch worker for: [Router] syntra.jd.parsed ...");
await pool.end();
