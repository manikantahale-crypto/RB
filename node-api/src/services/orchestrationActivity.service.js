const repo = require("../repositories/orchestrationActivity.repository");
const env = require("../config/env");

const AGENT_LABELS = {
  "01900000-0000-7000-8000-000000000501": "SYNTRA Matching (501)",
  "01900000-0000-7000-8000-000000000502": "SYNTRA Intake (502)",
  "01900000-0000-7000-8000-000000000504": "ASTRA (504)",
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

function buildTimeline(events, runs) {
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

  items.sort((a, b) => new Date(b.at) - new Date(a.at));
  return items.slice(0, 25);
}

async function getActivitySnapshot() {
  const [events, runs, worker, bindings] = await Promise.all([
    repo.getRecentPlatformEvents(20),
    repo.getRecentOrchRuns(12),
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
    timeline: buildTimeline(events, runs),
    proofHint:
      worker.status === "active"
        ? "Orchestrator worker is consuming events — see timeline below."
        : worker.status === "worker_offline"
          ? "Events are queued but not relayed — start: npm run dev:worker"
          : "Upload a JD or resume to generate orchestration events.",
  };
}

module.exports = { getActivitySnapshot, agentLabel };
