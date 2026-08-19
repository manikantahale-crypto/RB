/**
 * Demo prep + proof for Option B: ASTRA gate → SYNTRA matching.
 *
 *   npx tsx scripts/demo-astra-option-b.ts           # DB align + bindings + generate preview
 *   npx tsx scripts/demo-astra-option-b.ts --run     # also POST JD and print trace
 *
 * Requires worker + API :4100 for --run.
 * Use ORCH_STUB_SYNTRA=1 if Syntra HTTP is down; otherwise live Syntra :4000.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import dotenv from "dotenv";
import { generateGraphFromTemplate } from "../packages/authoring/src/generate-graph.ts";
import type { AgentTemplate } from "../packages/authoring/src/agent-template.ts";

dotenv.config({ path: resolve(process.cwd(), ".env") });

const ASTRA_ID = "01900000-0000-7000-8000-000000000504";
const API = process.env.ORCH_API_URL ?? "http://localhost:4100";
const ORG =
  process.env.SMOKE_ORG_ID ?? "2b8e12b3-1745-4ae9-902c-5a249c28ba94";
const doRun = process.argv.includes("--run");

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_MIGRATOR_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 25000,
});

const astraTools = [
  { name: "astra.requirement.intake", min_version: "1.0.0" },
  { name: "astra.requirement.ingest", min_version: "1.0.0" },
  { name: "astra.jobboard.fetch", min_version: "1.0.0" },
  { name: "astra.requirement.quality", min_version: "1.0.0" },
  { name: "astra.requirement.normalize", min_version: "1.0.0" },
  { name: "orch.branch.decision", min_version: "1.0.0" },
  { name: "human.gate", min_version: "1.0.0" },
  { name: "astra.route.decision", min_version: "1.0.0" },
];

const astraPolicy = {
  agentId: ASTRA_ID,
  agentKey: "astra",
  prompt:
    "When a job description arrives (upload, email, or job board), score quality, " +
    "branch to normalize or human review, then route actionable work to SYNTRA via syntra.jd.normalized.",
  allowedTools: [
    "astra.requirement.intake",
    "astra.requirement.ingest",
    "astra.jobboard.fetch",
    "astra.requirement.quality",
    "astra.requirement.normalize",
    "orch.branch.decision",
    "human.gate",
    "astra.route.decision",
  ],
  triggerEventType: "syntra.jd.received",
  retry: { max: 3, fallback: "human_review" },
  escalation: "none",
  guardrails: { piiRedact: false },
  minConfidence: 0,
  passMin: 0.6,
  humanMin: 0.35,
} as const;

const astraTemplate: AgentTemplate = {
  agentKey: "astra",
  displayName: "ASTRA — Requirement Intake Gate",
  policyExt: "AstraPolicyExt",
  nodes: [
    { id: "quality", impl: "astra.requirement.quality" },
    {
      id: "branch",
      impl: "orch.branch.decision",
      configFrom: ["passMin", "humanMin"],
    },
    { id: "normalize", impl: "astra.requirement.normalize" },
    { id: "human", impl: "human.gate" },
    {
      id: "route",
      impl: "astra.route.decision",
      configFrom: ["minConfidence"],
    },
  ],
  wiring: [
    ["__start__", "quality"],
    ["quality", "branch"],
    ["normalize", "route"],
    ["human", "route"],
    ["route", "__end__"],
  ],
  conditionalEdges: [
    {
      from: "branch",
      router: "branch_key",
      map: {
        pass: "normalize",
        human_review: "human",
        reject: "__end__",
      },
    },
  ],
  conditionalOn: {
    humanLoop:
      "orch.branch.decision → human.gate when confidence in [humanMin, passMin)",
  },
};

async function alignDb() {
  await pool.query(
    `UPDATE agent_definitions
        SET allowed_tools = $1::jsonb,
            purpose = $2,
            updated_at = now()
      WHERE id = $3`,
    [
      JSON.stringify(astraTools),
      "Ingest/score/normalize inbound JDs and route actionable requirements to SYNTRA.",
      ASTRA_ID,
    ],
  );

  await pool.query(
    `UPDATE agent_policies
        SET policy = $1::jsonb,
            updated_at = now()
      WHERE agent_id = $2
        AND org_id IS NULL
        AND version = 1`,
    [JSON.stringify(astraPolicy), ASTRA_ID],
  );

  await pool.query(
    `UPDATE agent_templates
        SET template = $1::jsonb,
            display_name = $2,
            version = 3,
            is_active = true,
            updated_at = now()
      WHERE id = $3`,
    [
      JSON.stringify(astraTemplate),
      "ASTRA — Requirement Intake Gate",
      "01900000-0000-7000-8000-000000000604",
    ],
  );

  const gen = generateGraphFromTemplate(astraPolicy as any, astraTemplate);
  console.log("\n=== GRAPH GENERATION (Admin Create workflow source) ===");
  console.log("Pipeline: agent_policies.policy + agent_templates.template");
  console.log("       → generateGraphFromTemplate() → astra.authored JSON");
  console.log("Runtime live ingress graph comes from graph_definitions:");
  console.log(
    "  astra.requirement.workflow@3 — quality → branch → normalize|human → route",
  );
  console.log(JSON.stringify(gen.definition, null, 2));

  try {
    const av = await pool.query(
      `SELECT COALESCE(MAX(version), 0) AS v FROM agent_versions WHERE agent_id = $1`,
      [ASTRA_ID],
    );
    const nextV = Number(av.rows[0].v) + 1;
    await pool.query(
      `INSERT INTO agent_versions (
         org_id, agent_id, version, artifact_source, checksum, status, created_by
       ) VALUES (NULL, $1, $2, $3, $4, 'generated', 'demo-astra-v3')`,
      [ASTRA_ID, nextV, gen.source, gen.checksum],
    );
    console.log(`Stored agent_versions astra@${nextV} status=generated`);
  } catch (e: any) {
    console.log("agent_versions note:", e.message);
  }

  for (const file of [
    "packages/db/migrations/V23__astra_option_b_bindings.sql",
    "packages/db/migrations/V24__astra_workflow_v3_branch.sql",
    "packages/db/migrations/V25__astra_event_schemas.sql",
  ]) {
    const sql = readFileSync(resolve(process.cwd(), file), "utf8");
    await pool.query(sql);
    console.log(`Applied ${file}`);
  }

  const binds = await pool.query(
    `SELECT event_type, graph_key, version, status,
            agent_id::text AS agent_id, module_queue, source
       FROM graph_event_bindings
      WHERE event_type IN (
        'syntra.jd.received',
        'syntra.jd.normalized',
        'astra.requirement.received',
        'astra.email.received',
        'astra.jobboard.fetch_requested'
      )
      ORDER BY event_type,
               CASE status WHEN 'active' THEN 0 ELSE 1 END,
               created_at DESC`,
  );
  console.log("\n=== BINDINGS (ASTRA ↔ SYNTRA) ===");
  console.table(binds.rows);

  const pol = await pool.query(
    `SELECT status,
            policy->'allowedTools' AS tools,
            policy->>'triggerEventType' AS trigger,
            policy->>'minConfidence' AS min_confidence,
            policy->>'passMin' AS pass_min,
            policy->>'humanMin' AS human_min
       FROM agent_policies
      WHERE agent_id = $1 AND org_id IS NULL AND version = 1`,
    [ASTRA_ID],
  );
  console.log("\n=== ASTRA agent_policies (Admin Policy Box) ===");
  console.log(JSON.stringify(pol.rows, null, 2));

  const graphs = await pool.query(
    `SELECT graph_key, version, status,
            jsonb_pretty(definition->'nodes') AS nodes,
            jsonb_pretty(definition->'conditionalEdges') AS conditional
       FROM graph_definitions
      WHERE graph_key LIKE 'astra%'
      ORDER BY graph_key, version`,
  );
  console.log("\n=== ASTRA graph_definitions (what worker compiles) ===");
  for (const g of graphs.rows) {
    console.log(`${g.graph_key}@${g.version} [${g.status}]`);
    console.log(g.nodes);
    if (g.conditional && g.conditional !== "null") {
      console.log("conditionalEdges:", g.conditional);
    }
  }
}

async function postJd() {
  const health = await fetch(`${API}/health`).catch(() => null);
  if (!health?.ok) {
    throw new Error(`API down at ${API}. Start: npm run start -w @tekisho/api`);
  }

  const corr = randomUUID();
  const jobId = randomUUID();
  const eventId = randomUUID();
  const body = {
    event_id: eventId,
    event_type: "syntra.jd.received",
    schema_version: "1.0",
    occurred_at: new Date().toISOString(),
    correlation_id: corr,
    causation_id: null,
    organization_id: ORG,
    aggregate: { type: "requirement", id: jobId },
    payload_ref: {
      jobId,
      requirement_id: jobId,
      title: "Demo JD — ASTRA quality→branch→normalize → SYNTRA",
      raw_text:
        "Senior React engineer. 5+ years TypeScript. Remote US. Immediate start. " +
        "Must have strong system design and CI/CD experience.",
    },
    producer: "demo-astra-option-b",
  };

  console.log(`\n=== POST syntra.jd.received event_id=${eventId} ===`);
  const res = await fetch(`${API}/v1/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  console.log("accepted", json);

  const deadline = Date.now() + 120_000;
  let last: any;
  while (Date.now() < deadline) {
    const t = await fetch(`${API}/v1/trace/${eventId}`);
    last = await t.json();
    const types = (last.outbox ?? []).map((e: any) => e.event_type);
    const hasBridge = types.includes("syntra.jd.normalized");
    const hasSyntraOutcome =
      types.includes("syntra.jd.parsed") ||
      types.includes("syntra.match.completed");
    const astraDone = (last.runs ?? []).some(
      (r: any) =>
        String(r.graph_key ?? "").includes("astra") &&
        (r.status === "COMPLETED" || r.status === "FAILED"),
    );
    const syntraDone = (last.runs ?? []).some(
      (r: any) =>
        String(r.graph_key ?? "").includes("syntra") &&
        (r.status === "COMPLETED" ||
          r.status === "FAILED" ||
          r.status === "RUNNING"),
    );
    if (astraDone && hasBridge && (hasSyntraOutcome || syntraDone)) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log("\n=== TRACE (events stored + tool steps) ===");
  for (const row of last?.outbox ?? []) {
    console.log(
      `  outbox  ${row.event_type}  producer=${row.producer}  id=${row.event_id}`,
    );
  }
  for (const run of last?.runs ?? []) {
    console.log(
      `  run     ${run.status}  ${run.graph_key ?? ""}@${run.graph_version ?? "?"}  source=${run.source ?? "?"}`,
    );
  }
  for (const step of last?.steps ?? []) {
    console.log(
      `  step    #${step.seq} ${step.node} ${step.status}` +
        (step.latency_ms != null ? ` ${step.latency_ms}ms` : ""),
    );
  }

  try {
    const steps = await pool.query(
      `SELECT s.seq, s.node, s.status, s.latency_ms,
              r.graph_key, r.status AS run_status,
              s.output_ref->>'branch_key' AS branch_key,
              s.output_ref->>'confidence_score' AS confidence_score
         FROM orch.steps s
         JOIN orch.runs r ON r.id = s.run_id
        WHERE r.trigger_event_id = $1::uuid
        ORDER BY r.started_at, s.seq`,
      [eventId],
    );
    if (steps.rows.length) {
      console.log("\n=== orch.steps (tool calls) ===");
      console.table(steps.rows);
    }
  } catch (e: any) {
    console.log("orch.steps query note:", e.message);
  }
}

async function main() {
  await alignDb();
  if (doRun) {
    await postJd();
  } else {
    console.log(
      "\nDB aligned. Re-run with --run after worker+API are up.",
    );
  }
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
