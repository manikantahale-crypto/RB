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

  /**
   * Per-agent artifacts: versions + runs with policy, workflow steps,
   * input/output events for Admin History (tabular UI).
   */
  app.get("/runtime/agent-artifacts/:agentId", async (req: any, reply: any) => {
    const agentId = String(req.params.agentId ?? "");
    if (!agentId) {
      return reply.code(400).send({ error: "agentId required" });
    }
    try {
      const versions = await pool.query(
        `SELECT v.id, v.version, v.status, v.checksum, v.generated_at, v.generated_by,
                v.artifact_ref, v.artifact_source, v.meta, v.policy_id,
                p.policy AS policy_json
           FROM agent_versions v
           LEFT JOIN agent_policies p ON p.id = v.policy_id
          WHERE v.agent_id = $1::uuid
          ORDER BY v.version DESC
          LIMIT 30`,
        [agentId],
      );

      const bindings = await pool.query(
        `SELECT event_type, graph_key, version, status, source, updated_at
           FROM graph_event_bindings
          WHERE agent_id = $1::uuid
          ORDER BY updated_at DESC NULLS LAST
          LIMIT 20`,
        [agentId],
      );

      const agent = await pool.query(
        `SELECT d.id, d.name, t.agent_key
           FROM agent_definitions d
           LEFT JOIN LATERAL (
             SELECT agent_key FROM agent_templates
              WHERE agent_id = d.id AND is_active = true
              ORDER BY version DESC LIMIT 1
           ) t ON true
          WHERE d.id = $1::uuid`,
        [agentId],
      );
      const agentKey = agent.rows[0]?.agent_key
        ? String(agent.rows[0].agent_key)
        : null;
      const authoredKey = agentKey ? `${agentKey}.authored` : null;

      const graphKeys = new Set<string>();
      for (const b of bindings.rows) {
        if (b.graph_key) graphKeys.add(String(b.graph_key));
      }
      if (authoredKey) graphKeys.add(authoredKey);
      for (const v of versions.rows) {
        const meta = v.meta && typeof v.meta === "object" ? v.meta : {};
        const gk = (meta as { graphKey?: string }).graphKey;
        if (gk) graphKeys.add(String(gk));
      }

      const keys = [...graphKeys];
      let runs: Array<Record<string, unknown>> = [];
      if (keys.length > 0) {
        const runQ = await pool.query(
          `SELECT id, organization_id, agent_name, trigger_event_id, graph_key,
                  status, langgraph_thread_id, error, input_ref,
                  started_at, completed_at, created_at
             FROM orch.runs
            WHERE graph_key = ANY($1::text[])
            ORDER BY created_at DESC
            LIMIT 40`,
          [keys],
        );
        runs = runQ.rows;
      }

      const runIds = runs
        .map((r) => r.id)
        .filter((id): id is string => typeof id === "string");

      let steps: Array<Record<string, unknown>> = [];
      if (runIds.length > 0) {
        const stepQ = await pool.query(
          `SELECT id, run_id, seq, node, tool_name, status, latency_ms,
                  output_ref, created_at
             FROM orch.steps
            WHERE run_id = ANY($1::uuid[])
            ORDER BY run_id, seq`,
          [runIds],
        );
        steps = stepQ.rows;
      }

      const stepsByRun = new Map<string, typeof steps>();
      for (const s of steps) {
        const rid = String(s.run_id);
        const list = stepsByRun.get(rid) ?? [];
        list.push(s);
        stepsByRun.set(rid, list);
      }

      const triggerIds = [
        ...new Set(
          runs
            .map((r) => r.trigger_event_id)
            .filter((id): id is string => id != null && String(id).length > 0)
            .map(String),
        ),
      ];

      const eventsByTrigger = new Map<
        string,
        Array<{
          eventType: string;
          eventId: string;
          producer: string | null;
          occurredAt: string | null;
          role: "input" | "output";
        }>
      >();

      if (triggerIds.length > 0) {
        const evQ = await pool.query(
          `SELECT event_id::text AS event_id, event_type, producer,
                  occurred_at, causation_id::text AS causation_id,
                  correlation_id::text AS correlation_id
             FROM event_outbox
            WHERE event_id::text = ANY($1::text[])
               OR causation_id::text = ANY($1::text[])
               OR correlation_id::text IN (
                    SELECT correlation_id::text FROM event_outbox
                     WHERE event_id::text = ANY($1::text[])
                  )
            ORDER BY occurred_at ASC NULLS LAST
            LIMIT 400`,
          [triggerIds],
        );
        const triggerSet = new Set(triggerIds);
        for (const e of evQ.rows) {
          const eid = String(e.event_id);
          // Attach to matching trigger(s) in the batch
          for (const tid of triggerIds) {
            const related =
              eid === tid ||
              String(e.causation_id ?? "") === tid ||
              // same correlation as this trigger event
              evQ.rows.some(
                (t) =>
                  String(t.event_id) === tid &&
                  t.correlation_id &&
                  t.correlation_id === e.correlation_id,
              );
            if (!related) continue;
            const list = eventsByTrigger.get(tid) ?? [];
            list.push({
              eventType: String(e.event_type),
              eventId: eid,
              producer: e.producer != null ? String(e.producer) : null,
              occurredAt: e.occurred_at
                ? new Date(e.occurred_at).toISOString()
                : null,
              role: triggerSet.has(eid) ? "input" : "output",
            });
            eventsByTrigger.set(tid, list);
          }
        }
      }

      const activeBinding = bindings.rows.find(
        (b) => String(b.status) === "active",
      );
      const activeVersionRow = versions.rows.find(
        (v) => String(v.status) === "active",
      );

      /** Prefer graph_event_bindings; fall back to active agent_versions row. */
      let liveVersion: {
        event_type: string;
        graph_key: string;
        version: number;
        status: string;
      } | null = activeBinding
        ? {
            event_type: String(activeBinding.event_type),
            graph_key: String(activeBinding.graph_key),
            version: Number(activeBinding.version),
            status: String(activeBinding.status),
          }
        : null;

      if (!liveVersion && activeVersionRow) {
        const meta =
          activeVersionRow.meta && typeof activeVersionRow.meta === "object"
            ? activeVersionRow.meta
            : {};
        const graphKeyFromMeta = (meta as { graphKey?: string }).graphKey;
        liveVersion = {
          event_type:
            triggerFromPolicy(activeVersionRow.policy_json) ??
            "syntra.jd.received",
          graph_key: String(graphKeyFromMeta ?? authoredKey ?? ""),
          version: Number(activeVersionRow.version),
          status: "active",
        };
      }

      function workflowStepsFromSource(source: unknown): Array<{
        order: number;
        title: string;
        impl: string;
        description?: string | null;
        config?: Record<string, unknown>;
      }> {
        if (!source || typeof source !== "string") return [];
        try {
          const parsed = JSON.parse(source) as {
            nodes?: Array<{
              id?: string;
              impl?: string;
              description?: string;
              config?: Record<string, unknown>;
            }>;
          };
          if (!Array.isArray(parsed.nodes)) return [];
          return parsed.nodes
            .filter(
              (n) =>
                n?.impl &&
                n.impl !== "__start__" &&
                n.impl !== "__end__" &&
                n.id !== "__start__" &&
                n.id !== "__end__",
            )
            .map((n, i) => ({
              order: i + 1,
              title: String(n.impl),
              impl: String(n.impl),
              description:
                typeof n.description === "string" && n.description.trim()
                  ? n.description.trim()
                  : null,
              config:
                n.config && typeof n.config === "object"
                  ? (n.config as Record<string, unknown>)
                  : undefined,
            }));
        } catch {
          return [];
        }
      }

      function policyTextFromJson(policy: unknown): string | null {
        if (!policy || typeof policy !== "object") return null;
        const p = policy as Record<string, unknown>;
        const prompt = p.prompt ?? p.policyText;
        return typeof prompt === "string" && prompt.trim()
          ? prompt.trim()
          : null;
      }

      function triggerFromPolicy(policy: unknown): string | null {
        if (!policy || typeof policy !== "object") return null;
        const t = (policy as Record<string, unknown>).triggerEventType;
        return typeof t === "string" && t.trim() ? t.trim() : null;
      }

      const statusFriendly = (status: string, needsHuman: boolean): string => {
        if (needsHuman) return "Waiting for a person";
        const s = status.toUpperCase();
        if (s.includes("COMPLET") || s === "OK") return "Finished";
        if (s.includes("FAIL") || s.includes("ERROR")) return "Failed";
        if (s.includes("RUN")) return "Running now";
        if (s.includes("QUEUE")) return "Queued";
        if (s.includes("CANCEL")) return "Cancelled";
        return status;
      };

      return reply.send({
        agentId,
        agentName: agent.rows[0]?.name ?? null,
        agentKey,
        liveNow: liveVersion
          ? {
              eventType: liveVersion.event_type,
              graphKey: liveVersion.graph_key,
              version: liveVersion.version,
              status: "live",
              summary: `Live — starts when ${liveVersion.event_type}`,
            }
          : null,
        liveBinding: liveVersion
          ? {
              eventType: liveVersion.event_type,
              graphKey: liveVersion.graph_key,
              version: liveVersion.version,
              status: liveVersion.status,
            }
          : null,
        versions: versions.rows.map((v) => {
          const meta = v.meta && typeof v.meta === "object" ? v.meta : {};
          const metaRec = meta as {
            graphKey?: string;
            unsupported?: string[];
            toolsUsed?: string[];
            builtSummary?: string;
          };
          const isLive =
            Boolean(liveVersion) &&
            Number(liveVersion!.version) === Number(v.version);
          const steps = workflowStepsFromSource(v.artifact_source);
          return {
            id: v.id,
            version: v.version,
            status: v.status,
            generatedAt: v.generated_at,
            generatedBy: v.generated_by,
            checksum: v.checksum,
            graphKey:
              metaRec.graphKey ??
              authoredKey ??
              null,
            isLive: Boolean(isLive),
            label:
              String(v.status) === "active" || isLive
                ? "Live"
                : String(v.status) === "generated" ||
                    String(v.status) === "pending_go_live"
                  ? "Generated"
                  : String(v.status) === "compiled" ||
                      String(v.status) === "published"
                    ? "Ready"
                    : String(v.status),
            policyText: policyTextFromJson(v.policy_json),
            triggerEventType: triggerFromPolicy(v.policy_json),
            workflowSteps: steps,
            unsupported: Array.isArray(metaRec.unsupported)
              ? metaRec.unsupported.filter((u): u is string => typeof u === "string")
              : [],
            toolsUsed: Array.isArray(metaRec.toolsUsed)
              ? metaRec.toolsUsed.filter((u): u is string => typeof u === "string")
              : steps.map((s) => s.impl),
            builtSummary:
              typeof metaRec.builtSummary === "string"
                ? metaRec.builtSummary
                : null,
          };
        }),
        runs: runs.map((r) => {
          const rid = String(r.id);
          const runSteps = stepsByRun.get(rid) ?? [];
          const tid = r.trigger_event_id
            ? String(r.trigger_event_id)
            : null;
          const related = tid ? eventsByTrigger.get(tid) ?? [] : [];
          // Deduplicate by eventId
          const seen = new Set<string>();
          const events = related.filter((e) => {
            if (seen.has(e.eventId)) return false;
            seen.add(e.eventId);
            return true;
          });
          const inputEvent =
            events.find((e) => e.role === "input") ?? events[0] ?? null;
          const outputEvents = events.filter((e) => e.role === "output");
          const needsHuman =
            String(r.status).includes("INTERRUPT") ||
            String(r.status) === "PAUSED" ||
            String(r.status) === "WAITING_APPROVAL" ||
            (Boolean(r.langgraph_thread_id) &&
              !String(r.status).toUpperCase().includes("COMPLET") &&
              !String(r.status).toUpperCase().includes("FAIL"));

          const mappedSteps = runSteps.map((s) => {
            const out =
              s.output_ref && typeof s.output_ref === "object"
                ? (s.output_ref as Record<string, unknown>)
                : {};
            return {
              seq: s.seq,
              node: s.node,
              tool: s.tool_name,
              status: s.status,
              latencyMs: s.latency_ms,
              branchKey: out.branch_key ?? null,
              result: out.result ?? s.status,
              confidence:
                out.confidence_score != null ? out.confidence_score : null,
              output: out,
            };
          });

          const runningStep = [...mappedSteps]
            .reverse()
            .find(
              (s) =>
                String(s.status).toUpperCase() === "RUNNING" ||
                String(s.status).toUpperCase() === "OK",
            );
          const currentAction = needsHuman
            ? "Waiting for Approve / Reject"
            : String(r.status).toUpperCase().includes("RUN")
              ? runningStep
                ? `Doing: ${String(runningStep.tool ?? runningStep.node)}`
                : "Running…"
              : String(r.status).toUpperCase().includes("COMPLET")
                ? "Finished"
                : statusFriendly(String(r.status), needsHuman);

          // Prefer live-bound version, then any version with same graph key + steps,
          // then latest version that has a stored workflow.
          const byLive =
            liveVersion &&
            versions.rows.find(
              (v) => Number(v.version) === Number(liveVersion.version),
            );
          const byKey = versions.rows.find((v) => {
            const meta = v.meta && typeof v.meta === "object" ? v.meta : {};
            const gk =
              (meta as { graphKey?: string }).graphKey ?? authoredKey;
            return (
              gk &&
              String(gk) === String(r.graph_key) &&
              workflowStepsFromSource(v.artifact_source).length > 0
            );
          });
          const byLatestWithSteps = versions.rows.find(
            (v) => workflowStepsFromSource(v.artifact_source).length > 0,
          );
          const matchingVersion = byLive || byKey || byLatestWithSteps || null;

          const failMsg =
            r.error == null
              ? null
              : typeof r.error === "string"
                ? r.error
                : typeof r.error === "object" &&
                    r.error &&
                    "message" in (r.error as object)
                  ? String((r.error as { message?: unknown }).message ?? "")
                  : JSON.stringify(r.error);

          return {
            id: rid,
            graphKey: r.graph_key,
            status: r.status,
            statusLabel: failMsg
              ? "Failed"
              : statusFriendly(String(r.status), needsHuman),
            currentAction: failMsg
              ? `Failed: ${failMsg.slice(0, 120)}`
              : currentAction,
            triggerEventId: tid,
            createdAt: r.created_at,
            completedAt: r.completed_at,
            error: r.error,
            needsHuman,
            threadId: r.langgraph_thread_id ?? null,
            organizationId: r.organization_id,
            inputEventType: inputEvent?.eventType ?? null,
            outputEventTypes: outputEvents.map((e) => e.eventType),
            events,
            policyText: matchingVersion
              ? policyTextFromJson(matchingVersion.policy_json)
              : null,
            workflowSteps: matchingVersion
              ? workflowStepsFromSource(matchingVersion.artifact_source)
              : [],
            graphVersion: matchingVersion?.version ?? null,
            steps: mappedSteps,
          };
        }),
      });
    } catch (err: any) {
      return reply.code(500).send({
        error: "artifacts_unavailable",
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
