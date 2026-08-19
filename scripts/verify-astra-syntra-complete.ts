/**
 * Verify ASTRA tools + Syntra HTTP + Admin catalog + branch thresholds.
 *
 *   npx tsx scripts/verify-astra-syntra-complete.ts
 */
import { resolve } from "node:path";
import dotenv from "dotenv";
import { getToolCatalog } from "../packages/authoring/src/tool-registry.ts";
import { orchBranchDecision } from "../packages/orchestrator/src/nodes/branch.ts";
import { createNodeCtx } from "../packages/orchestrator/src/nodes/ctx.ts";
import type { SyntraGraphState } from "../packages/orchestrator/src/nodes/types.ts";
import type { EventInput } from "../packages/orchestrator/src/types.ts";

dotenv.config({ path: resolve(process.cwd(), ".env") });

const ADMIN = process.env.ADMIN_API_URL ?? "http://localhost:4200";
const ORCH = process.env.ORCH_API_URL ?? "http://localhost:4100";
const SYNTRA = process.env.SYNTRA_API_URL ?? "http://localhost:4000";

const REQUIRED_TOOLS = [
  "astra.requirement.intake",
  "astra.requirement.ingest",
  "astra.jobboard.fetch",
  "astra.requirement.quality",
  "astra.requirement.normalize",
  "astra.route.decision",
  "orch.branch.decision",
  "human.gate",
  "syntra.jd.process",
  "syntra.match.process",
];

function ok(label: string, detail?: string) {
  console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
}
function fail(label: string, detail?: string) {
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function ping(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  let failures = 0;
  console.log("\n=== 1. Shared TOOL_CATALOG (all agents) ===");
  const keys = new Set(getToolCatalog().map((t) => t.key));
  for (const t of REQUIRED_TOOLS) {
    if (keys.has(t)) ok(t);
    else {
      fail(t, "missing from TOOL_CATALOG");
      failures++;
    }
  }

  console.log("\n=== 2. Branch thresholds (passMin / humanMin / confidence_score) ===");
  const base = (score: number): SyntraGraphState => {
    const trigger: EventInput = {
      event_id: "e1",
      event_type: "astra.requirement.scored",
      aggregate_id: "j1",
      aggregate_type: "requirement",
      organization_id: "o1",
      correlation_id: "c1",
      payload: { is_actionable: true, confidence_score: score },
    };
    return {
      result: "",
      _emittedEvents: [],
      trigger_event: trigger,
      profile: null,
      matches: [],
      agent_run_id: null,
    };
  };
  const { ctx } = createNodeCtx({
    orgId: "o1",
    config: { passMin: 0.6, humanMin: 0.35 },
  });
  const cases: Array<[number, string]> = [
    [0.8, "pass"],
    [0.45, "human_review"],
    [0.1, "reject"],
  ];
  for (const [score, expect] of cases) {
    const out = await orchBranchDecision(base(score), ctx);
    if (out.branch_key === expect) ok(`score ${score} → ${expect}`);
    else {
      fail(`score ${score}`, `got ${out.branch_key}, want ${expect}`);
      failures++;
    }
  }

  console.log("\n=== 3. Service health ===");
  const adminUp = await ping(`${ADMIN}/health`);
  const orchUp = await ping(`${ORCH}/health`);
  const syntraUp = await ping(`${SYNTRA}/health`).catch(() => false);
  // Syntra may use /api/health
  const syntraUp2 =
    syntraUp ||
    (await ping(`${SYNTRA}/api/health`).catch(() => false)) ||
    (await fetch(`${SYNTRA}/internal/astra/requirements/quality`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Verify JD",
        raw_text:
          "Senior TypeScript engineer with React experience. Remote US. Five years.",
      }),
    })
      .then((r) => r.ok || r.status < 500)
      .catch(() => false));

  if (adminUp) ok("Admin API", ADMIN);
  else {
    fail("Admin API", `${ADMIN} down — npm run dev:admin`);
    failures++;
  }
  if (orchUp) ok("Orch API", ORCH);
  else {
    fail("Orch API", `${ORCH} down — npm run start -w @tekisho/api`);
    failures++;
  }
  if (syntraUp2) ok("Syntra ASTRA HTTP", SYNTRA);
  else {
    fail("Syntra", `${SYNTRA} down — start node-api; ORCH_STUB_SYNTRA is now 0`);
    failures++;
  }

  if (adminUp) {
    console.log("\n=== 4. Admin catalog (frontend source) ===");
    const toolsRes = await fetch(`${ADMIN}/catalog/tools`);
    const toolsJson = (await toolsRes.json()) as {
      tools?: Array<{ key: string }>;
    };
    const adminKeys = new Set((toolsJson.tools ?? []).map((t) => t.key));
    for (const t of [
      "astra.requirement.normalize",
      "orch.branch.decision",
      "human.gate",
    ]) {
      if (adminKeys.has(t)) ok(`Admin /catalog/tools has ${t}`);
      else {
        fail(`Admin catalog missing ${t}`);
        failures++;
      }
    }

    const runsRes = await fetch(`${ADMIN}/runtime/runs?limit=5`);
    if (runsRes.ok) ok("Admin /runtime/runs");
    else {
      fail("Admin /runtime/runs", String(runsRes.status));
      failures++;
    }
  }

  if (syntraUp2) {
    console.log("\n=== 5. Real Syntra quality + normalize ===");
    const q = await fetch(`${SYNTRA}/internal/astra/requirements/quality`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Senior React Engineer",
        raw_text:
          "We need a Senior React / TypeScript engineer with 5+ years experience, " +
          "CI/CD, and system design. Remote US. Immediate start.",
      }),
    });
    const qj = (await q.json()) as Record<string, unknown>;
    if (q.ok && typeof qj.confidence_score === "number") {
      ok(
        "quality",
        `confidence_score=${qj.confidence_score} actionable=${qj.is_actionable}`,
      );
    } else {
      fail("quality", JSON.stringify(qj).slice(0, 200));
      failures++;
    }

    const ingest = await fetch(`${SYNTRA}/internal/astra/requirements/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Verify ingest JD",
        raw_text:
          "Backend engineer Node.js PostgreSQL. 4 years. Hybrid NYC. Benefits included.",
        channel_type: "API",
        source: "verify-script",
      }),
    });
    const ij = (await ingest.json()) as Record<string, unknown>;
    const jobId = String(ij.jobId ?? ij.requirement_id ?? "");
    if (ingest.ok && jobId) {
      ok("ingest", `jobId=${jobId}`);
      const n = await fetch(
        `${SYNTRA}/internal/astra/requirements/${jobId}/normalize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId,
            raw_text:
              "Backend engineer Node.js PostgreSQL. 4 years. Hybrid NYC. Benefits included.",
            title: "Verify ingest JD",
          }),
        },
      );
      const nj = (await n.json()) as Record<string, unknown>;
      if (n.ok) ok("normalize", `status=${nj.status} conf=${nj.confidence_score}`);
      else {
        fail("normalize", JSON.stringify(nj).slice(0, 200));
        failures++;
      }
    } else {
      fail("ingest", JSON.stringify(ij).slice(0, 200));
      failures++;
    }
  }

  console.log("\n=== Summary ===");
  console.log(
    failures === 0
      ? "All checks passed. Open Admin → Runs for traceability; Builder tools include ASTRA for every agent."
      : `${failures} check(s) failed. Fix services / Syntra, then re-run.`,
  );
  console.log(`ORCH_STUB_SYNTRA=${process.env.ORCH_STUB_SYNTRA ?? "(unset)"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
