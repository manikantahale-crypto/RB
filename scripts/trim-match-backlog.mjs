/**
 * Keep one requirement's worth of match scoring; drop the rest, and the
 * notification path with it.
 *
 *   node scripts/trim-match-backlog.mjs --dry-run     # show, change nothing
 *   node scripts/trim-match-backlog.mjs               # apply
 *
 * WHY THIS EXISTS. 1,834 `syntra.match.requested` jobs accumulated while no
 * worker was draining them, from bursts on 20 and 22 September. They are real,
 * distinct events — not retries, not a loop — and each asks the orchestrator to
 * SCORE a `core.matches` row that node-api already created. At roughly a minute
 * apiece that is about thirty hours of running, and every completion fans out
 * into a consent email to a candidate.
 *
 * WHAT IT DOES, IN ONE TRANSACTION:
 *
 *   1. RETIRES the binding `syntra.match.completed → syntra.shortlist.workflow`.
 *      That is the only path from a scored match to an email. Reversible: set
 *      the row back to 'active'.
 *
 *   2. DELETES queued jobs already routed to that workflow. Retiring the
 *      binding does not reach them — the ingress router resolved it when it
 *      enqueued, so `__graphKey` is baked into the job data and the worker
 *      would run them anyway.
 *
 *   3. DELETES the scoring jobs except those for ONE requirement, so there is
 *      still a real slice to watch the whole path work on.
 *
 * WHAT IT DOES NOT TOUCH: `core.matches`, `orch.runs`, `orch.event_outbox`.
 * The outbox is already fully drained, so nothing refills the queue.
 *
 * WHAT YOU GIVE UP. The dropped pairs stay unscored for good. Re-running
 * matching will NOT recreate them: `insertShortlistRow` is
 * `ON CONFLICT DO NOTHING`, so the funnel sees the row already exists and skips
 * the enqueue (`matching/funnel.js`, "Already exists — do not enqueue again").
 * Test end-to-end with a FRESH JD or resume, not by re-matching one of these.
 */
import "dotenv/config";
import pg from "pg";

/** The requirement whose jobs are kept. PHP Developer — 16 pending matches. */
const KEEP_REQUIREMENT = process.env.KEEP_REQUIREMENT ?? "7f6b786d-250c-4907-9fa3-e568d422366e";
const DRY_RUN = process.argv.includes("--dry-run");

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  ssl: { rejectUnauthorized: false },
});

async function snapshot(client, label) {
  const { rows: jobs } = await client.query(
    `SELECT coalesce(data->>'__graphKey', '(not yet routed)') AS graph_key,
            count(*)::int AS n
       FROM pgboss.job
      WHERE name = 'module.syntra.match' AND state IN ('created','retry')
      GROUP BY 1 ORDER BY 2 DESC`,
  );
  const { rows: binding } = await client.query(
    `SELECT b.status, count(*)::int AS n
       FROM authoring.event_bindings b
       JOIN authoring.graphs g ON g.id = b.graph_id
      WHERE b.event_type = 'syntra.match.completed'
        AND g.graph_key = 'syntra.shortlist.workflow'
      GROUP BY 1 ORDER BY 1`,
  );
  console.log(`\n── ${label} ──`);
  console.log("module.syntra.match queue:");
  console.table(jobs);
  console.log("syntra.match.completed → syntra.shortlist.workflow binding:");
  console.table(binding);
}

async function main() {
  const client = await pool.connect();
  try {
    await snapshot(client, "before");

    await client.query("BEGIN");

    const binding = await client.query(
      `UPDATE authoring.event_bindings b
          SET status = 'retired', updated_at = now()
         FROM authoring.graphs g
        WHERE g.id = b.graph_id
          AND b.event_type = 'syntra.match.completed'
          AND g.graph_key  = 'syntra.shortlist.workflow'
          AND b.status = 'active'`,
    );

    const notifications = await client.query(
      `DELETE FROM pgboss.job
        WHERE name = 'module.syntra.match'
          AND state IN ('created','retry')
          AND data->>'__graphKey' = 'syntra.shortlist.workflow'`,
    );

    const scoring = await client.query(
      `DELETE FROM pgboss.job
        WHERE name = 'module.syntra.match'
          AND state IN ('created','retry')
          AND data->>'__graphKey' = 'syntra.match.workflow'
          AND (data->'payload_ref'->>'jobId') IS DISTINCT FROM $1`,
      [KEEP_REQUIREMENT],
    );

    console.log(`\n  binding retired ......... ${binding.rowCount} row(s)`);
    console.log(`  notification jobs dropped ${notifications.rowCount}`);
    console.log(`  scoring jobs dropped ..... ${scoring.rowCount}`);

    if (DRY_RUN) {
      await client.query("ROLLBACK");
      console.log("\n--dry-run: rolled back, nothing changed.");
    } else {
      await client.query("COMMIT");
      console.log("\ncommitted.");
    }

    await snapshot(client, DRY_RUN ? "after (rolled back — unchanged)" : "after");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("\nROLLED BACK — nothing changed:", error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
