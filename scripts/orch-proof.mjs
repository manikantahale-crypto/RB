/**
 * Print proof that orchestration is driving the app (outbox → worker → graphs).
 *
 * Usage:
 *   npm run orch:proof
 *   npm run orch:proof -- --watch
 */
import pg from "pg";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env") });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const ORCH = (process.env.ORCH_API_URL || "http://localhost:4100").replace(/\/$/, "");
const watch = process.argv.includes("--watch");

const AGENTS = {
  "01900000-0000-7000-8000-000000000501": "SYNTRA Match (501)",
  "01900000-0000-7000-8000-000000000502": "SYNTRA Intake (502)",
  "01900000-0000-7000-8000-000000000504": "ASTRA (504)",
};

function agent(id) {
  return AGENTS[id] ?? (id ? id.slice(0, 8) + "…" : "—");
}

async function orchHealth() {
  try {
    const r = await fetch(`${ORCH}/health`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function printProof() {
  console.clear?.();
  console.log("══════════════════════════════════════════════════════════");
  console.log(" ORCHESTRATION PROOF — is the worker driving the app?");
  console.log("══════════════════════════════════════════════════════════\n");

  const orchOk = await orchHealth();
  console.log(`Orch API (${ORCH}): ${orchOk ? "✓ UP" : "✗ DOWN — run npm run dev:orch-api"}`);

  const pending = await pool.query(
    `SELECT count(*)::int AS n FROM event_outbox
      WHERE published_at IS NULL AND occurred_at > now() - interval '2 hours'`,
  );
  const relayed = await pool.query(
    `SELECT count(*)::int AS n, max(published_at) AS last_at FROM event_outbox
      WHERE published_at > now() - interval '15 minutes'`,
  );
  const runs = await pool.query(
    `SELECT count(*)::int AS n, max(created_at) AS last_at FROM orch.runs
      WHERE created_at > now() - interval '15 minutes'`,
  ).catch(() => ({ rows: [{ n: 0, last_at: null }] }));

  const pendingN = pending.rows[0]?.n ?? 0;
  const relayedN = relayed.rows[0]?.n ?? 0;
  const runsN = runs.rows[0]?.n ?? 0;

  if (relayedN > 0 || runsN > 0) {
    console.log("\n✓ WORKER IS ACTIVE (events relayed or graphs ran in last 15 min)");
  } else if (pendingN > 0) {
    console.log("\n✗ WORKER OFFLINE — events queued but not relayed");
    console.log("  → Start: npm run dev:worker");
  } else {
    console.log("\n○ IDLE — upload JD/resume in UI to generate events");
  }

  console.log(`\n  Pending relay:     ${pendingN}`);
  console.log(`  Relayed (15m):     ${relayedN}  last=${relayed.rows[0]?.last_at ?? "—"}`);
  console.log(`  Graph runs (15m):  ${runsN}  last=${runs.rows[0]?.last_at ?? "—"}`);

  console.log("\n── Active event → graph bindings ──");
  const bindings = await pool.query(
    `SELECT event_type, graph_key, agent_id::text FROM graph_event_bindings
      WHERE status='active' AND org_id IS NULL AND event_type ~ '^(syntra|astra)\\.'
      ORDER BY event_type`,
  );
  for (const b of bindings.rows) {
    console.log(`  ${b.event_type}`);
    console.log(`    → ${b.graph_key}  (${agent(b.agent_id)})`);
  }

  console.log("\n── Recent platform events (newest first) ──");
  const events = await pool.query(
    `SELECT e.event_type, e.producer, e.published_at IS NOT NULL AS relayed,
            e.occurred_at, b.graph_key, b.agent_id::text
       FROM event_outbox e
       LEFT JOIN graph_event_bindings b
         ON b.event_type=e.event_type AND b.status='active' AND b.org_id IS NULL
      WHERE e.event_type ~ '^(syntra|astra|orbit)\\.'
         OR e.producer IN ('orchestrator','syntra.node-api','astra-intake')
      ORDER BY e.occurred_at DESC LIMIT 10`,
  );
  if (events.rows.length === 0) {
    console.log("  (none yet)");
  } else {
    for (const e of events.rows) {
      const route = e.graph_key ? ` → ${e.graph_key} (${agent(e.agent_id)})` : "";
      console.log(
        `  ${e.relayed ? "✓" : "⏳"} ${e.event_type} [${e.producer}]${route}`,
      );
      console.log(`      at ${e.occurred_at}`);
    }
  }

  console.log("\n── Recent graph executions (orch.runs) ──");
  const orchRuns = await pool.query(
    `SELECT agent_name, graph_key, status, trigger_event_id::text, created_at,
            (SELECT count(*)::int FROM orch.steps s WHERE s.run_id=r.id) AS steps
       FROM orch.runs r ORDER BY created_at DESC LIMIT 8`,
  ).catch(() => ({ rows: [] }));
  if (orchRuns.rows.length === 0) {
    console.log("  (none yet — worker may be off or no events triggered graphs)");
  } else {
    for (const r of orchRuns.rows) {
      console.log(
        `  ${r.status.padEnd(12)} ${r.graph_key}  agent=${r.agent_name}  steps=${r.steps}`,
      );
      console.log(`      trigger=${r.trigger_event_id}  at ${r.created_at}`);
    }
  }

  console.log("\n── What to watch in worker terminal ──");
  console.log("  [Relay] PUBLISH syntra.jd.parsed …");
  console.log("  [Router] ROUTE syntra.jd.parsed → graph=syntra.continuous.match agent=501");
  console.log("  [Module] START … syntra.continuous.match");
  console.log("  [WorkflowRunner] EMIT → syntra.match.requested …");
  console.log("  [Router] ROUTE syntra.match.requested → graph=syntra.match.workflow");
  console.log("\n══════════════════════════════════════════════════════════\n");
}

async function main() {
  if (watch) {
    for (;;) {
      await printProof();
      await new Promise((r) => setTimeout(r, 8000));
    }
  } else {
    await printProof();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
