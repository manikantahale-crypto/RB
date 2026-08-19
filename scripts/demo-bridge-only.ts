/**
 * Post a single syntra.jd.normalized event to prove SYNTRA binding/routing.
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: resolve(process.cwd(), ".env") });

const API = process.env.ORCH_API_URL ?? "http://localhost:4100";
const ORG =
  process.env.SMOKE_ORG_ID ?? "2b8e12b3-1745-4ae9-902c-5a249c28ba94";

async function main() {
  const health = await fetch(`${API}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`API down at ${API}`);

  const eventId = randomUUID();
  const jobId = randomUUID();
  const corr = randomUUID();
  const body = {
    event_id: eventId,
    event_type: "syntra.jd.normalized",
    schema_version: "1.0",
    occurred_at: new Date().toISOString(),
    correlation_id: corr,
    causation_id: null,
    organization_id: ORG,
    aggregate: { type: "requirement", id: jobId },
    payload_ref: {
      jobId,
      requirement_id: jobId,
      status: "normalized",
      is_actionable: true,
      confidence_score: 0.9,
      parser_version: "orch.stub.astra.v1",
      title: "Demo bridge → SYNTRA",
    },
    producer: "demo-bridge-only",
  };

  console.log(`POST syntra.jd.normalized ${eventId}`);
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
    const syntraDone = (last.runs ?? []).some(
      (r: any) =>
        String(r.graph_key ?? "").includes("syntra") &&
        (r.status === "COMPLETED" || r.status === "FAILED"),
    );
    const steps = (last.steps ?? []).length;
    if (syntraDone || steps > 0) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log("\n=== TRACE ===");
  for (const row of last?.outbox ?? []) {
    console.log(`  outbox  ${row.event_type}  producer=${row.producer}`);
  }
  for (const run of last?.runs ?? []) {
    console.log(
      `  run     ${run.status}  ${run.graph_key ?? ""}  source=${run.source ?? "?"}`,
    );
  }
  for (const step of last?.steps ?? []) {
    console.log(`  step    #${step.seq} ${step.node} ${step.status}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
