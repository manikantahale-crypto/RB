/**
 * Stop the retry workflow re-running old failures, and clear what it made.
 *
 *   node scripts/stop-retry-fanout.mjs --dry-run    # show, change nothing
 *   node scripts/stop-retry-fanout.mjs              # apply
 *
 * STOP THE WORKER FIRST (Ctrl-C). It enqueues faster than this deletes, so
 * running it against a live worker leaves a queue that refills behind you.
 *
 * WHAT IS HAPPENING. `syntra.agent_run.failed → syntra.run.retry.workflow` is
 * active, so every historically FAILED run is being re-run. That looks like
 * recovery and is not: a retried resume run calls node-api's funnel, and the
 * funnel matches that resume against EVERY open requirement — about 28 of
 * them. So one retry becomes ~28 new `core.matches` rows and ~28 new
 * `syntra.match.requested` events.
 *
 * Measured over half an hour: 563 new matches, 20 distinct resumes, 76
 * requirements. New match jobs arrived at ~24 a minute while the worker
 * completed about 1.4 a minute. It grows faster than it drains, which is why
 * the terminal never goes quiet.
 *
 * It is a fan-out, not a self-feeding loop — but with 1,926 historically
 * failed runs to work through, the distinction does not help.
 *
 * WHAT THIS DOES, IN ONE TRANSACTION:
 *
 *   1. RETIRES the retry binding. Reversible — set the row back to 'active'.
 *      Worth doing deliberately later, once failures are rare enough that
 *      re-running one is a small act rather than a fan-out.
 *   2. DELETES queued retry jobs, including any already routed (retiring the
 *      binding does not reach those — `__graphKey` is baked in at enqueue).
 *   3. DELETES the reconcile queue. `runForResume` used to publish one
 *      `job.activated` per surviving job — about 1,700 per resume — and each
 *      one runs a full funnel that creates more match rows. That publish is
 *      gone (the reconcile now writes the pairs it already scored), so these
 *      are orphans of a version that no longer exists.
 *   4. DELETES the match and ingress backlog the fan-out produced.
 *
 * WHAT IT DOES NOT TOUCH: `core.matches`, `orch.runs`, `orch.event_outbox`.
 * The rows it created stay, unscored; nothing refills the queue once the
 * binding is retired.
 */
import "dotenv/config";
import pg from "pg";

const DRY_RUN = process.argv.includes("--dry-run");

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  ssl: { rejectUnauthorized: false },
});

async function snapshot(client, label) {
  const { rows: jobs } = await client.query(
    `SELECT name, state, count(*)::int AS n
       FROM pgboss.job WHERE state IN ('created','retry','active')
      GROUP BY 1,2 ORDER BY 3 DESC`,
  );
  const { rows: bindings } = await client.query(
    `SELECT b.event_type, g.graph_key, b.status
       FROM authoring.event_bindings b
       JOIN authoring.graphs g ON g.id = b.graph_id
      WHERE b.event_type IN ('syntra.agent_run.failed','syntra.match.completed')
      ORDER BY 1, 3`,
  );
  console.log(`\n── ${label} ──`);
  console.table(jobs);
  console.table(bindings);
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
          AND b.event_type = 'syntra.agent_run.failed'
          AND g.graph_key  = 'syntra.run.retry.workflow'
          AND b.status = 'active'`,
    );

    const retries = await client.query(
      `DELETE FROM pgboss.job
        WHERE state IN ('created','retry')
          AND (data->>'__graphKey' = 'syntra.run.retry.workflow'
               OR data->>'event_type' = 'syntra.agent_run.failed')`,
    );

    const reconcile = await client.query(
      `DELETE FROM pgboss.job
        WHERE name = 'job.activated'
          AND state IN ('created','retry')`,
    );

    const backlog = await client.query(
      `DELETE FROM pgboss.job
        WHERE name IN ('module.syntra.match','orchestration.ingress')
          AND state IN ('created','retry')`,
    );

    console.log(`\n  retry binding retired ..... ${binding.rowCount} row(s)`);
    console.log(`  retry jobs dropped ........ ${retries.rowCount}`);
    console.log(`  reconcile jobs dropped .... ${reconcile.rowCount}`);
    console.log(`  match/ingress backlog ..... ${backlog.rowCount}`);

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
