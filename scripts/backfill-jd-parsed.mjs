/**
 * Backfill syntra.jd.parsed for jobs that were AI-processed before platform-events wiring.
 * Run: node scripts/backfill-jd-parsed.mjs [--dry-run] [--limit=50]
 */
import pg from "pg";
import { config } from "dotenv";
import { resolve } from "node:path";
import { createRequire } from "node:module";

config({ path: resolve(process.cwd(), ".env") });

const require = createRequire(import.meta.url);
const platformEvents = require("../node-api/src/services/platformEvents.service.js");

const dryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 50;

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const { rows: jobs } = await pool.query(
  `SELECT j.id::text, j.title, j.processed_at
     FROM syntra.jobs j
    WHERE j.processed_at IS NOT NULL
      AND j.processing_failed_at IS NULL
      AND NOT EXISTS (
            SELECT 1 FROM event_outbox e
             WHERE e.event_type = 'syntra.jd.parsed'
               AND e.aggregate_id = j.id
          )
    ORDER BY j.processed_at DESC
    LIMIT $1`,
  [limit],
);

console.log(
  JSON.stringify(
    {
      dryRun,
      limit,
      candidateJobs: jobs.length,
      jobs: jobs.map((j) => ({ id: j.id, title: j.title })),
    },
    null,
    2,
  ),
);

if (dryRun) {
  console.log("\nDry run — no events written. Remove --dry-run to emit.");
  await pool.end();
  process.exit(0);
}

let ok = 0;
let fail = 0;
for (const job of jobs) {
  try {
    const row = await platformEvents.publishJdParsed({ jobId: job.id });
    if (row) {
      console.log(`✓ emitted syntra.jd.parsed job=${job.id} event_id=${row.event_id}`);
      ok += 1;
    } else {
      console.warn(`✗ skipped job=${job.id} (PLATFORM_EVENTS_ENABLED=0?)`);
      fail += 1;
    }
  } catch (err) {
    console.error(`✗ failed job=${job.id}:`, err.message);
    fail += 1;
  }
}

console.log(`\nDone: ${ok} emitted, ${fail} failed/skipped`);
console.log("Keep npm run dev:worker running to relay events to orchestrator.");
await pool.end();
process.exit(fail > 0 ? 1 : 0);
