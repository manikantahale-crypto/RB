/**
 * Full-stack smoke: Admin tools/LLM + Syntra ASTRA + Orch demo path.
 *
 *   npx tsx scripts/smoke-full-stack.ts
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: resolve(process.cwd(), ".env") });

const ADMIN = process.env.ADMIN_API_URL ?? "http://localhost:4200";
const ORCH = process.env.ORCH_API_URL ?? "http://localhost:4100";
const SYNTRA = process.env.SYNTRA_API_URL ?? "http://localhost:4000";
const ORG =
  process.env.SMOKE_ORG_ID ?? "2b8e12b3-1745-4ae9-902c-5a249c28ba94";
const ASTRA_ID = "01900000-0000-7000-8000-000000000504";

const RICH_JD =
  "Senior React TypeScript Engineer — 5+ years building production SPAs with React, " +
  "TypeScript, GraphQL, Jest, Playwright, CI/CD on AWS. Remote US. System design required. " +
  "Immediate start. Competitive compensation and full benefits package.";

function pass(msg: string) {
  console.log(`  PASS  ${msg}`);
}
function fail(msg: string): never {
  console.error(`  FAIL  ${msg}`);
  process.exit(1);
}

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  return { res, body: body as Record<string, any> };
}

async function main() {
  console.log("\n=== A. Services ===");
  for (const [name, url] of [
    ["Orch", `${ORCH}/health`],
    ["Admin", `${ADMIN}/health`],
  ] as const) {
    const { res } = await json(url);
    if (!res.ok) fail(`${name} down`);
    pass(`${name} healthy`);
  }
  const q = await json(`${SYNTRA}/internal/astra/requirements/quality`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Senior React Engineer", raw_text: RICH_JD }),
  });
  if (!q.res.ok) fail(`Syntra quality ${q.res.status}`);
  pass(
    `Syntra quality conf=${q.body.confidence_score} actionable=${q.body.is_actionable}`,
  );
  if (Number(q.body.confidence_score) < 0.6) {
    console.warn(
      "  WARN  score < passMin — orch may reject; still exercising tools",
    );
  }

  console.log("\n=== B. Admin catalog (tools available to all agents) ===");
  const tools = await json(`${ADMIN}/catalog/tools`);
  if (!tools.res.ok) fail("catalog/tools");
  const keys = new Set((tools.body.tools ?? []).map((t: any) => t.key));
  for (const k of [
    "astra.requirement.quality",
    "astra.requirement.normalize",
    "orch.branch.decision",
    "human.gate",
    "astra.route.decision",
    "syntra.jd.process",
  ]) {
    if (!keys.has(k)) fail(`missing tool ${k}`);
    pass(`catalog has ${k}`);
  }

  console.log("\n=== C. Admin LLM generate (preview) — ASTRA agent ===");
  const agent = await json(`${ADMIN}/agents/${ASTRA_ID}`);
  if (!agent.res.ok) fail(`get agent ${agent.res.status}`);
  const policy = agent.body.policy?.policy ?? agent.body.policy;
  if (!policy) fail("no policy on ASTRA agent");
  const version = agent.body.policy?.version ?? 1;
  const gen = await json(`${ADMIN}/agents/${ASTRA_ID}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-id": "admin-local",
    },
    body: JSON.stringify({
      policy,
      expectedVersion: version,
      mode: "llm",
      preview: true,
      request:
        "When a JD arrives, score quality, branch with passMin 0.6 and humanMin 0.35, " +
        "normalize good JDs, send ambiguous ones to human review, then route actionable " +
        "work to SYNTRA via syntra.jd.normalized.",
    }),
  });
  if (!gen.res.ok) {
    console.error(JSON.stringify(gen.body, null, 2).slice(0, 800));
    fail(`LLM generate ${gen.res.status}: ${gen.body.message ?? gen.body.error}`);
  }
  const def = gen.body.definition;
  const impls = (def?.nodes ?? []).map((n: any) => n.impl);
  pass(`LLM preview status=${gen.body.status} nodes=${impls.join(" → ")}`);
  const usedAstra = impls.some((i: string) => String(i).startsWith("astra."));
  const usedBranch = impls.includes("orch.branch.decision");
  if (usedAstra) pass("LLM selected ASTRA tool(s)");
  else console.warn("  WARN  LLM did not pick an astra.* tool (check prompt/catalog)");
  if (usedBranch) pass("LLM selected orch.branch.decision");
  else console.warn("  WARN  LLM did not pick orch.branch.decision");
  if (gen.body.generationTrace?.mode) {
    pass(`generationTrace mode=${gen.body.generationTrace.mode}`);
  }

  console.log("\n=== D. Orch event → ASTRA workflow (real Syntra) ===");
  if ((process.env.ORCH_STUB_SYNTRA ?? "").match(/^(1|true|force)$/i)) {
    console.warn("  WARN  ORCH_STUB_SYNTRA is on — set 0 for real Syntra in worker");
  }
  const eventId = randomUUID();
  const jobId = randomUUID();
  const corr = randomUUID();
  const post = await json(`${ORCH}/v1/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
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
        title: "Senior React TypeScript Engineer",
        raw_text: RICH_JD,
      },
      producer: "smoke-full-stack",
    }),
  });
  if (!post.res.ok) fail(`POST event ${JSON.stringify(post.body)}`);
  pass(`event accepted ${eventId}`);

  let last: any = null;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const t = await json(`${ORCH}/v1/trace/${eventId}`);
    last = t.body;
    const types = (last.outbox ?? []).map((e: any) => e.event_type);
    const astraDone = (last.runs ?? []).some(
      (r: any) =>
        String(r.graph_key ?? "").includes("astra") &&
        (r.status === "COMPLETED" || r.status === "FAILED"),
    );
    if (
      astraDone &&
      (types.includes("syntra.jd.normalized") ||
        types.includes("astra.requirement.rejected") ||
        types.includes("syntra.approval.requested"))
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  const types = (last?.outbox ?? []).map((e: any) => e.event_type);
  console.log("  outbox:", types.join(", "));
  for (const s of last?.steps ?? []) {
    const out = s.output_ref ?? {};
    console.log(
      `  step #${s.seq} ${s.node} ${s.status}` +
        (out.branch_key ? ` branch=${out.branch_key}` : "") +
        (out.confidence_score != null ? ` conf=${out.confidence_score}` : "") +
        (s.latency_ms != null ? ` ${s.latency_ms}ms` : ""),
    );
  }
  if (!(last?.steps?.length > 0)) fail("no orch steps — is worker up?");
  pass(`ASTRA steps=${last.steps.length}`);

  if (types.includes("syntra.jd.normalized")) {
    pass("bridge syntra.jd.normalized emitted → SYNTRA matching should follow");
  } else if (types.includes("astra.requirement.rejected")) {
    pass("reject path exercised (score/actionable below gate)");
  } else if (types.includes("syntra.approval.requested")) {
    pass("human_review path — approve via Admin Runs page");
  } else {
    fail("no terminal ASTRA outcome event");
  }

  console.log("\n=== E. Admin runtime trace ===");
  const rt = await json(`${ADMIN}/runtime/trace/${eventId}`);
  if (rt.res.ok) {
    pass(
      `Admin trace runs=${rt.body.runs_count} steps=${rt.body.steps_count}`,
    );
  } else {
    console.warn(
      `  WARN  Admin /runtime/trace ${rt.res.status} — restart admin-api if needed`,
    );
  }

  console.log("\nAll smoke checks finished.");
  console.log(`Open Admin UI http://localhost:5173/runs and paste event_id=${eventId}`);
  console.log(`Orch trace: ${ORCH}/v1/trace/${eventId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
