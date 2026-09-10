const { pool } = require("../config/db");

const PLATFORM_EVENT_PREFIX = /^(syntra|astra|orbit)\./;

async function getRecentPlatformEvents(limit = 20) {
  const { rows } = await pool.query(
    `SELECT e.event_id::text,
            e.event_type,
            e.producer,
            e.correlation_id::text,
            e.causation_id::text,
            e.aggregate_type,
            e.aggregate_id::text,
            e.occurred_at,
            e.published_at,
            b.graph_key,
            NULL::text AS agent_id
       FROM event_outbox e
       LEFT JOIN authoring.event_bindings eb
         ON eb.event_type = e.event_type
        AND eb.status = 'active'
        AND eb.org_id IS NULL
       LEFT JOIN authoring.graphs b ON b.id = eb.graph_id
      WHERE e.event_type ~ '^(syntra|astra|orbit)\\.'
         OR e.producer IN ('orchestrator', 'syntra.node-api', 'astra-intake')
      ORDER BY e.occurred_at DESC NULLS LAST
      LIMIT $1`,
    [limit],
  );
  return rows;
}

async function getRecentOrchRuns(limit = 15) {
  try {
    const { rows } = await pool.query(
      `SELECT r.id::text,
              r.organization_id::text,
              r.agent_name,
              r.graph_key,
              r.status,
              r.trigger_event_id::text,
              r.langgraph_thread_id,
              r.started_at,
              r.completed_at,
              r.created_at,
              (SELECT count(*)::int FROM orch.steps s WHERE s.run_id = r.id) AS step_count
         FROM orch.runs r
        ORDER BY r.created_at DESC NULLS LAST
        LIMIT $1`,
      [limit],
    );
    return rows;
  } catch (err) {
    if (/does not exist|permission denied/i.test(err.message)) return [];
    throw err;
  }
}

async function getWorkerHealth() {
  const pending = await pool.query(
    `SELECT count(*)::int AS n
       FROM event_outbox
      WHERE published_at IS NULL
        AND occurred_at > now() - interval '2 hours'`,
  );
  const recentPublished = await pool.query(
    `SELECT count(*)::int AS n, max(published_at) AS last_published
       FROM event_outbox
      WHERE published_at IS NOT NULL
        AND published_at > now() - interval '15 minutes'`,
  );
  const recentRuns = await pool.query(
    `SELECT count(*)::int AS n, max(created_at) AS last_run
       FROM orch.runs
      WHERE created_at > now() - interval '15 minutes'`,
  ).catch(() => ({ rows: [{ n: 0, last_run: null }] }));

  const unpublished = pending.rows[0]?.n ?? 0;
  const publishedRecent = recentPublished.rows[0]?.n ?? 0;
  const runsRecent = recentRuns.rows[0]?.n ?? 0;

  let status = "unknown";
  if (publishedRecent > 0 || runsRecent > 0) {
    status = unpublished > 5 ? "degraded" : "active";
  } else if (unpublished > 0) {
    status = "worker_offline";
  } else {
    status = "idle";
  }

  return {
    status,
    unpublishedPending: unpublished,
    publishedLast15Min: publishedRecent,
    runsLast15Min: runsRecent,
    lastPublishedAt: recentPublished.rows[0]?.last_published ?? null,
    lastRunAt: recentRuns.rows[0]?.last_run ?? null,
  };
}

async function getRecentOrchSteps(limit = 40) {
  try {
    const { rows } = await pool.query(
      `SELECT s.id::text,
              s.run_id::text,
              s.seq,
              s.node,
              s.tool_name,
              s.status,
              s.latency_ms,
              s.created_at,
              r.agent_name,
              r.graph_key,
              r.trigger_event_id::text
         FROM orch.steps s
         JOIN orch.runs r ON r.id = s.run_id
        ORDER BY s.created_at DESC NULLS LAST
        LIMIT $1`,
      [limit],
    );
    return rows;
  } catch (err) {
    if (/does not exist|permission denied/i.test(err.message)) return [];
    throw err;
  }
}

async function getActiveBindings() {
  const { rows } = await pool.query(
    /**
     * `agent_id` is gone from the binding — a binding names a workflow now,
     * not the agent that authored it — so the screen labels the workflow,
     * which is what the row is actually about.
     */
    `SELECT b.event_type, g.graph_key, NULL::text AS agent_id, b.source
       FROM authoring.event_bindings b
       JOIN authoring.graphs g ON g.id = b.graph_id
      WHERE b.status = 'active'
        AND b.org_id IS NULL
        AND event_type ~ '^(syntra|astra)\\.'
      ORDER BY event_type`,
  );
  return rows;
}

module.exports = {
  getRecentPlatformEvents,
  getRecentOrchRuns,
  getRecentOrchSteps,
  getWorkerHealth,
  getActiveBindings,
  PLATFORM_EVENT_PREFIX,
};
