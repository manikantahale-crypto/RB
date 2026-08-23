const repo = require("../repositories/orchestrationActivity.repository");
const env = require("../config/env");

const AGENT_LABELS = {
  "01900000-0000-7000-8000-000000000501": "SYNTRA Matching (501)",
  "01900000-0000-7000-8000-000000000502": "SYNTRA Intake (502)",
  "01900000-0000-7000-8000-000000000504": "ASTRA (504)",
  "01900000-0000-7000-8000-000000000505": "ORBIT Bench (505)",
};

function agentLabel(agentId) {
  if (!agentId) return null;
  return AGENT_LABELS[agentId] ?? `Agent ${agentId.slice(0, 8)}…`;
}

function describeEvent(row) {
  const graph = row.graph_key ? ` → graph ${row.graph_key}` : "";
  const agent = row.agent_id ? ` (${agentLabel(row.agent_id)})` : "";
  const relay = row.published_at ? "relayed ✓" : "awaiting worker";
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    producer: row.producer,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    occurredAt: row.occurred_at,
    publishedAt: row.published_at,
    relayStatus: relay,
    routedTo: row.graph_key
      ? { graphKey: row.graph_key, agentId: row.agent_id, agentLabel: agentLabel(row.agent_id) }
      : null,
    summary: `${row.event_type} [${row.producer}]${graph}${agent} — ${relay}`,
  };
}

function describeRun(row) {
  return {
    runId: row.id,
    agentName: row.agent_name,
    graphKey: row.graph_key,
    status: row.status,
    triggerEventId: row.trigger_event_id,
    stepCount: row.step_count,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    summary: `Agent "${row.agent_name}" ran ${row.graph_key} → ${row.status} (${row.step_count} steps)`,
  };
}

function describeStep(row) {
  const tool = row.tool_name || row.node || "step";
  return {
    stepId: row.id,
    runId: row.run_id,
    seq: row.seq,
    node: row.node,
    toolName: row.tool_name,
    status: row.status,
    latencyMs: row.latency_ms,
    agentName: row.agent_name,
    graphKey: row.graph_key,
    at: row.created_at,
    summary: `${row.agent_name}: ${tool} → ${row.status}${row.latency_ms != null ? ` (${row.latency_ms}ms)` : ""}`,
  };
}

function buildTimeline(events, runs, steps) {
  const items = [];

  for (const e of events) {
    items.push({
      kind: "event",
      at: e.occurred_at,
      ...describeEvent(e),
    });
  }
  for (const r of runs) {
    items.push({
      kind: "run",
      at: r.created_at,
      ...describeRun(r),
    });
  }
  for (const s of steps) {
    items.push({
      kind: "tool",
      at: s.created_at,
      ...describeStep(s),
    });
  }

  items.sort((a, b) => new Date(b.at) - new Date(a.at));
  return items.slice(0, 30);
}

async function getActivitySnapshot() {
  const [events, runs, steps, worker, bindings] = await Promise.all([
    repo.getRecentPlatformEvents(20),
    repo.getRecentOrchRuns(12),
    repo.getRecentOrchSteps(25),
    repo.getWorkerHealth(),
    repo.getActiveBindings(),
  ]);

  let orchApiOk = false;
  try {
    const res = await fetch(`${env.ORCH_API_URL || "http://localhost:4100"}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    orchApiOk = res.ok;
  } catch {
    orchApiOk = false;
  }

  return {
    enabled: env.PLATFORM_EVENTS_ENABLED !== "0" && env.PLATFORM_EVENTS_ENABLED !== "false",
    delegateMatch: env.ORCH_DELEGATE_MATCH === "1",
    organizationId: env.ORCH_ORGANIZATION_ID,
    orchApiUrl: env.ORCH_API_URL || "http://localhost:4100",
    orchApiOk,
    worker,
    bindings: bindings.map((b) => ({
      eventType: b.event_type,
      graphKey: b.graph_key,
      agentId: b.agent_id,
      agentLabel: agentLabel(b.agent_id),
      source: b.source,
    })),
    recentEvents: events.map(describeEvent),
    recentRuns: runs.map(describeRun),
    recentSteps: steps.map(describeStep),
    timeline: buildTimeline(events, runs, steps),
    proofHint:
      worker.status === "active"
        ? "Orchestrator active — upload JD/resume or match; watch terminal 2 for [Orch] logs."
        : worker.status === "worker_offline"
          ? "Events queued but worker offline — run: npm run dev:orch (terminal 2)"
          : "Upload a JD or resume to generate orchestration events.",
  };
}

module.exports = { getActivitySnapshot, agentLabel };
