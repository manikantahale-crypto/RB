/**
 * Runtime observability for Admin — traces orch.runs / orch.steps / outbox
 * and resumes parked human.gate threads via the orch API.
 */
import type { Pool } from "pg";

type FastifyLike = {
  get: (path: string, handler: any) => void;
  post: (path: string, handler: any) => void;
};

const ORCH_API = process.env.ORCH_API_URL ?? "http://localhost:4100";

async function loadTrace(pool: Pool, eventId: string) {
  const outbox = await pool.query(
    `SELECT event_id, event_type, organization_id, correlation_id,
            aggregate_type, aggregate_id, producer, payload_ref,
            occurred_at, published_at, causation_id
       FROM event_outbox
      WHERE event_id::text = $1
         OR causation_id::text = $1
         OR (
           correlation_id::text = (
             SELECT correlation_id::text FROM event_outbox
              WHERE event_id::text = $1 LIMIT 1
           )
         )
      ORDER BY occurred_at ASC NULLS LAST`,
    [eventId],
  );

  let runs: Array<Record<string, unknown>> = [];
  try {
    const orchRuns = await pool.query(
      `SELECT id, organization_id, agent_name, trigger_event_id, graph_key,
              status, langgraph_thread_id, error,
              started_at, completed_at, created_at
         FROM orch.runs
        WHERE trigger_event_id::text = $1
        ORDER BY created_at ASC`,
      [eventId],
    );
    runs = orchRuns.rows.map((row) => ({ ...row, source: "orch.runs" }));
  } catch {
    runs = [];
  }

  const runIds = runs
    .map((r) => r.id)
    .filter((id): id is string => typeof id === "string");

  let steps: Array<Record<string, unknown>> = [];
  if (runIds.length > 0) {
    const orchSteps = await pool.query(
      `SELECT id, run_id AS agent_run_id, seq, node, tool_name, status,
              latency_ms, output_ref, created_at
         FROM orch.steps
        WHERE run_id = ANY($1::uuid[])
        ORDER BY run_id, seq`,
      [runIds],
    );
    steps = orchSteps.rows.map((row) => ({ ...row, source: "orch.steps" }));
  }

  return { outbox: outbox.rows, runs, steps };
}

export function registerRuntimeRoutes(app: FastifyLike, pool: Pool): void {
  app.get("/runtime/trace/:eventId", async (req: any, reply: any) => {
    const eventId = String(req.params.eventId ?? "");
    if (!eventId) {
      return reply.code(400).send({ error: "eventId required" });
    }
    try {
      const trace = await loadTrace(pool, eventId);
      return reply.send({
        eventId,
        outbox_count: trace.outbox.length,
        runs_count: trace.runs.length,
        steps_count: trace.steps.length,
        ...trace,
      });
    } catch (err: any) {
      return reply.code(500).send({
        error: "trace_failed",
        message: err?.message ?? String(err),
      });
    }
  });

  app.get("/runtime/runs", async (req: any, reply: any) => {
    const limit = Math.min(Number(req.query?.limit ?? 40), 100);
    try {
      const { rows } = await pool.query(
        `SELECT id, organization_id, agent_name, trigger_event_id, graph_key,
                status, langgraph_thread_id, error,
                started_at, completed_at, created_at
           FROM orch.runs
          ORDER BY created_at DESC
          LIMIT $1`,
        [limit],
      );
      return reply.send({ runs: rows });
    } catch (err: any) {
      return reply.code(500).send({
        error: "runs_unavailable",
        message: err?.message ?? String(err),
      });
    }
  });

  app.get("/runtime/runs/:runId/steps", async (req: any, reply: any) => {
    const runId = String(req.params.runId ?? "");
    try {
      const { rows } = await pool.query(
        `SELECT id, run_id, seq, node, tool_name, status, latency_ms,
                output_ref, created_at
           FROM orch.steps
          WHERE run_id = $1::uuid
          ORDER BY seq`,
        [runId],
      );
      return reply.send({ runId, steps: rows });
    } catch (err: any) {
      return reply.code(500).send({
        error: "steps_unavailable",
        message: err?.message ?? String(err),
      });
    }
  });

  app.get("/runtime/overview", async (_req: any, reply: any) => {
    try {
      const runsTotal = await pool.query(
        `SELECT count(*)::int AS n FROM orch.runs`,
      );
      const runsByStatus = await pool.query(
        `SELECT status, count(*)::int AS n
           FROM orch.runs
          GROUP BY status
          ORDER BY n DESC`,
      );
      const runsByGraph = await pool.query(
        `SELECT graph_key, count(*)::int AS n,
                max(created_at) AS last_run_at
           FROM orch.runs
          GROUP BY graph_key
          ORDER BY n DESC
          LIMIT 20`,
      );
      const graphsGenerated = await pool.query(
        `SELECT count(*)::int AS n FROM agent_versions
          WHERE status IN ('generated', 'pending_go_live', 'compiled', 'published', 'active')`,
      );
      const graphsActive = await pool.query(
        `SELECT count(*)::int AS n FROM graph_definitions WHERE status = 'active'`,
      );
      const bindings = await pool.query(
        `SELECT event_type, graph_key, version, agent_id::text AS agent_id,
                module_queue, source, status
           FROM graph_event_bindings
          WHERE status = 'active'
          ORDER BY event_type`,
      );
      const handoffs = await pool.query(
        `SELECT
           count(*) FILTER (WHERE event_type = 'syntra.jd.normalized')::int AS bridge_to_syntra,
           count(*) FILTER (WHERE event_type = 'astra.requirement.rejected')::int AS astra_rejected,
           count(*) FILTER (WHERE event_type = 'astra.requirement.scored')::int AS astra_scored,
           count(*) FILTER (WHERE event_type = 'syntra.jd.parsed')::int AS syntra_parsed,
           count(*) FILTER (WHERE event_type = 'syntra.approval.requested')::int AS human_gates
         FROM event_outbox
         WHERE occurred_at > now() - interval '14 days'`,
      );
      const recent = await pool.query(
        `SELECT id, organization_id, agent_name, trigger_event_id, graph_key,
                status, langgraph_thread_id, error,
                started_at, completed_at, created_at
           FROM orch.runs
          ORDER BY created_at DESC
          LIMIT 25`,
      );

      return reply.send({
        stats: {
          runsTotal: runsTotal.rows[0]?.n ?? 0,
          graphsGenerated: graphsGenerated.rows[0]?.n ?? 0,
          graphsActive: graphsActive.rows[0]?.n ?? 0,
          runsByStatus: runsByStatus.rows,
          runsByGraph: runsByGraph.rows,
          handoffs14d: handoffs.rows[0] ?? {},
        },
        liveBindings: bindings.rows,
        recentRuns: recent.rows,
        howOrchPicksUp:
          "After Make live / Activate, Admin writes graph_event_bindings " +
          "(event_type → graph_key@version). The orch worker listens on ingress; " +
          "when that event arrives it compiles the bound graph and runs its tools. " +
          "ASTRA route emitting syntra.jd.normalized starts the SYNTRA binding next.",
      });
    } catch (err: any) {
      return reply.code(500).send({
        error: "overview_unavailable",
        message: err?.message ?? String(err),
      });
    }
  });

  app.post("/runtime/threads/resume", async (req: any, reply: any) => {
    const body = req.body ?? {};
    if (!body.thread_id || !body.graph_key || !body.organization_id) {
      return reply.code(422).send({
        error: "invalid_body",
        required: ["thread_id", "graph_key", "organization_id"],
      });
    }
    try {
      const res = await fetch(`${ORCH_API}/v1/threads/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: body.thread_id,
          graph_key: body.graph_key,
          graph_version: body.graph_version,
          organization_id: body.organization_id,
          decision: body.decision ?? { approved: true },
        }),
      });
      const json = await res.json().catch(() => ({}));
      return reply.code(res.status).send(json);
    } catch (err: any) {
      return reply.code(502).send({
        error: "orch_unreachable",
        message: err?.message ?? String(err),
        orchApi: ORCH_API,
      });
    }
  });
}
