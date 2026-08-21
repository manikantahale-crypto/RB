/**
 * End-to-end workflow health check for unified SYNTRA + orchestrator stack.
 * Run: node scripts/verify-workflow.mjs
 */
import pg from "pg";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env") });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const checks = [];

function ok(name, detail) {
  checks.push({ status: "OK", name, detail });
}
function warn(name, detail) {
  checks.push({ status: "WARN", name, detail });
}
function fail(name, detail) {
  checks.push({ status: "FAIL", name, detail });
}

const envFlags = {
  PLATFORM_EVENTS_ENABLED: process.env.PLATFORM_EVENTS_ENABLED ?? "(default true)",
  ORCH_DELEGATE_MATCH: process.env.ORCH_DELEGATE_MATCH ?? "(default true)",
  ORCH_ORGANIZATION_ID: process.env.ORCH_ORGANIZATION_ID ?? "(missing)",
  ORCH_EMIT_JD_RECEIVED: process.env.ORCH_EMIT_JD_RECEIVED ?? "0",
  SYNTRA_API_URL: process.env.SYNTRA_API_URL ?? "http://localhost:4000",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ? "set" : "empty",
  LLM_API_KEY: process.env.LLM_API_KEY ? "set" : "empty",
  AI_PROVIDER: process.env.AI_PROVIDER ?? "openrouter",
};

if (envFlags.PLATFORM_EVENTS_ENABLED === "1" || envFlags.PLATFORM_EVENTS_ENABLED === "(default true)") {
  ok("env PLATFORM_EVENTS_ENABLED", String(envFlags.PLATFORM_EVENTS_ENABLED));
} else {
  fail("env PLATFORM_EVENTS_ENABLED", "Must be 1 for orchestrator wiring");
}

if (envFlags.ORCH_DELEGATE_MATCH === "1" || envFlags.ORCH_DELEGATE_MATCH === "(default true)") {
  ok("env ORCH_DELEGATE_MATCH", "Orchestrator owns match scoring + JD funnel via jd.parsed");
} else {
  warn("env ORCH_DELEGATE_MATCH", "Internal match.requested worker used instead of orch graph");
}

const orgId = process.env.ORCH_ORGANIZATION_ID || "00000000-0000-0000-0000-000000000001";
const org = await pool.query(`SELECT id::text, name FROM organizations WHERE id = $1`, [orgId]);
if (org.rows[0]) {
  ok("ORCH_ORGANIZATION_ID", `${org.rows[0].name} (${orgId})`);
} else {
  fail("ORCH_ORGANIZATION_ID", `${orgId} not in organizations — outbox FK will fail`);
}

const aiKey =
  process.env.GEMINI_API_KEY ||
  process.env.LLM_API_KEY ||
  process.env.AI_API_KEY ||
  process.env.OPENROUTER_API_KEY;
if (aiKey) {
  ok("AI API key", `provider=${envFlags.AI_PROVIDER}`);
} else {
  fail("AI API key", "Set GEMINI_API_KEY or LLM_API_KEY — JD/resume workers never reach jd.parsed");
}

for (const eventType of ["syntra.jd.parsed", "syntra.match.requested", "syntra.profile.prepared"]) {
  const b = await pool.query(
    `SELECT graph_key, agent_id::text, source FROM graph_event_bindings
      WHERE event_type = $1 AND status = 'active' AND org_id IS NULL LIMIT 1`,
    [eventType],
  );
  if (b.rows[0]) {
    ok(`binding ${eventType}`, `${b.rows[0].graph_key} agent=${b.rows[0].agent_id} (${b.rows[0].source})`);
  } else {
    fail(`binding ${eventType}`, "No active binding — run npm run dev:worker once or Flyway seed");
  }
}

const outbox = await pool.query(`
  SELECT event_type, COUNT(*)::int AS n,
         COUNT(*) FILTER (WHERE published_at IS NULL)::int AS pending
    FROM event_outbox
   WHERE event_type LIKE 'syntra.%'
     AND occurred_at > now() - interval '7 days'
   GROUP BY event_type
   ORDER BY event_type
`);
if (outbox.rows.some((r) => r.event_type === "syntra.jd.parsed" && r.n > 0)) {
  ok("outbox syntra.jd.parsed", `${outbox.rows.find((r) => r.event_type === "syntra.jd.parsed").n} row(s)`);
} else {
  warn(
    "outbox syntra.jd.parsed",
    "No rows in 7 days — restart node-api after merge, upload JD, grep for [platformEvents] EMIT",
  );
}

const pending = await pool.query(
  `SELECT COUNT(*)::int AS n FROM event_outbox WHERE published_at IS NULL`,
);
if (pending.rows[0].n > 0) {
  warn("outbox relay", `${pending.rows[0].n} unpublished row(s) — is npm run dev:worker running?`);
} else {
  ok("outbox relay", "No stuck unpublished rows (or outbox empty)");
}

try {
  const res = await fetch(`${envFlags.SYNTRA_API_URL}/health`, { signal: AbortSignal.timeout(3000) });
  if (res.ok) ok("Syntra API", envFlags.SYNTRA_API_URL);
  else warn("Syntra API", `${envFlags.SYNTRA_API_URL} returned ${res.status}`);
} catch {
  fail("Syntra API", `${envFlags.SYNTRA_API_URL} unreachable — orch graphs will fail with ORCH_STUB_SYNTRA=0`);
}

console.log("\n=== Unified workflow verification ===\n");
for (const c of checks) {
  const icon = c.status === "OK" ? "✓" : c.status === "WARN" ? "!" : "✗";
  console.log(`${icon} [${c.status}] ${c.name}`);
  console.log(`    ${c.detail}\n`);
}

const failed = checks.filter((c) => c.status === "FAIL").length;
console.log(failed === 0 ? "All critical checks passed.\n" : `${failed} critical issue(s) — fix before expecting orch output.\n`);

await pool.end();
process.exit(failed > 0 ? 1 : 0);
