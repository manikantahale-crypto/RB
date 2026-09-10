/**
 * Screen 1 — the workflows registry.
 *
 * One row per GRAPH KEY. That is the difference between this and
 * `/builder/overview`, which starts from `agent_definitions` and describes the
 * trial-era model where an agent owned a workflow. The registry is the
 * platform view: a graph key exists whether or not an agent wraps it, and the
 * screen has to show keys nobody has bundled.
 *
 * Everything on this screen is DERIVED. Nothing here is hand-maintained, so
 * nothing here can go stale (principle 6). Triggers come from the bindings
 * table, health from the run tables, versions from the definitions table.
 *
 * The one judgement encoded below is `orphan`: an active graph with no active
 * binding can never run. The deck calls this the defensive orphan check, and
 * it is worth surfacing because it is invisible from every other screen —
 * the graph looks live, and simply never fires.
 */
import type { Pool } from "pg";
import { withOrgScope } from "../with-org-scope.js";

import { GRAPH_DEFINITIONS, GRAPH_EVENT_BINDINGS } from "../lib/authoring-views.js";
type FastifyLike = {
  get: (path: string, handler: any) => void;
};

function readOrgId(headers: Record<string, unknown>): string | null {
  const raw = headers["x-org-id"];
  if (raw === undefined || raw === null || raw === "" || raw === "~global~") {
    return null;
  }
  return String(raw);
}

/** `syntra.match.workflow` → `syntra`. The prefix is the module, by convention. */
function moduleOf(graphKey: string): string {
  const head = graphKey.split(".")[0] ?? "";
  return head || "unknown";
}

/**
 * Does `orch.runs` have the pinned-version column yet?
 *
 * It is added by the worker's `ensureOrchAuditTables` on boot, because this
 * repository has no migration runner — so whether the column exists depends on
 * whether anyone has started a worker against this database. Admin API must
 * work either way: a fresh clone reads runs fine and simply shows the version
 * as unknown, rather than returning 500 until someone runs the right process.
 *
 * Checked once per process. If it appears later, restarting admin-api picks it
 * up; that is a fair trade against a catalog query on every request.
 */
let hasGraphVersion: boolean | null = null;
async function graphVersionColumnExists(client: {
  query: (text: string) => Promise<{ rows: unknown[] }>;
}): Promise<boolean> {
  if (hasGraphVersion !== null) return hasGraphVersion;
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'orch' AND table_name = 'runs'
        AND column_name = 'graph_version' LIMIT 1`,
  );
  hasGraphVersion = rows.length > 0;
  return hasGraphVersion;
}

export type WorkflowRegistryRow = {
  graphKey: string;
  module: string;
  /** Event types with an ACTIVE binding pointing here. Empty means unreachable. */
  triggers: string[];
  activeVersion: number | null;
  /** Org-scoped active version, when this org overrides the global one. */
  orgActiveVersion: number | null;
  draftCount: number;
  versionCount: number;
  health: {
    runs24h: number;
    failed24h: number;
    waiting: number;
    lastRunAt: string | null;
  };
  /** Active definition, no active binding — it can never fire. */
  orphan: boolean;
};

export type WorkflowRun = {
  runId: string;
  graphKey: string;
  /** Which door fired — matters when several events start one workflow. */
  triggerEvent: string | null;
  triggerEventId: string | null;
  orgId: string | null;
  /** The version this run executed, when knowable. */
  pinnedVersion: number | null;
  /** How we know it: stored by the runtime, or the graph's only version. */
  versionSource: "recorded" | "inferred" | null;
  status: string;
  agentName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  correlationId: string | null;
  error: unknown;
  stepCount: number;
};

export function registerWorkflowRoutes(app: FastifyLike, pool: Pool): void {
  /**
   * GET /workflows — the registry.
   *
   * Org-aware: `x-org-id` surfaces that org's overriding versions alongside
   * the global ones, because "v3 global · v4 canary @acme" is one row on this
   * screen, not two.
   */
  app.get("/workflows", async (req: any, reply: any) => {
    const orgId = readOrgId(req.headers);

    try {
      return await withOrgScope(pool, orgId, async (client) => {
        const { rows } = await client.query(
          `
          SELECT
            d.graph_key,
            max(d.version) FILTER (
              WHERE d.status = 'active' AND d.org_id IS NULL
            ) AS active_global,
            max(d.version) FILTER (
              WHERE d.status = 'active' AND d.org_id IS NOT NULL AND d.org_id = $1
            ) AS active_org,
            count(*) FILTER (WHERE d.status = 'draft')  AS draft_count,
            count(*)                                    AS version_count,
            (
              SELECT coalesce(array_agg(DISTINCT b.event_type), '{}')
              FROM ${GRAPH_EVENT_BINDINGS} b
              WHERE b.graph_key = d.graph_key AND b.status = 'active'
            ) AS triggers,
            (
              SELECT count(*) FROM orch.runs r
              WHERE r.graph_key = d.graph_key
                AND r.created_at > now() - interval '24 hours'
            ) AS runs_24h,
            (
              SELECT count(*) FROM orch.runs r
              WHERE r.graph_key = d.graph_key AND r.status = 'FAILED'
                AND r.created_at > now() - interval '24 hours'
            ) AS failed_24h,
            (
              -- WAITING is a healthy state, not a failure: a run parked at a
              -- human gate for days is working as designed. Counted without a
              -- time window because that is the point — it is still waiting.
              SELECT count(*) FROM orch.runs r
              WHERE r.graph_key = d.graph_key AND r.status = 'WAITING_APPROVAL'
            ) AS waiting,
            (
              SELECT max(r.created_at) FROM orch.runs r
              WHERE r.graph_key = d.graph_key
            ) AS last_run_at
          FROM ${GRAPH_DEFINITIONS} d
          GROUP BY d.graph_key
          ORDER BY runs_24h DESC, d.graph_key ASC
          `,
          [orgId],
        );

        const workflows: WorkflowRegistryRow[] = rows.map((r: any) => {
          const activeVersion = r.active_global ?? null;
          const triggers: string[] = r.triggers ?? [];
          return {
            graphKey: r.graph_key,
            module: moduleOf(r.graph_key),
            triggers,
            activeVersion,
            orgActiveVersion: r.active_org ?? null,
            draftCount: Number(r.draft_count ?? 0),
            versionCount: Number(r.version_count ?? 0),
            health: {
              runs24h: Number(r.runs_24h ?? 0),
              failed24h: Number(r.failed_24h ?? 0),
              waiting: Number(r.waiting ?? 0),
              lastRunAt: r.last_run_at
                ? new Date(r.last_run_at).toISOString()
                : null,
            },
            // Live but unreachable. Draft-only keys are not orphans — they are
            // simply not released yet.
            orphan: activeVersion !== null && triggers.length === 0,
          };
        });

        return { workflows, orgId };
      });
    } catch (err) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "workflows_query_failed", message: String(err) });
    }
  });

  /**
   * Screen 12 — every run of one workflow.
   *
   * Reached from the registry's runs cell, and bookmarkable on its own, which
   * is how on-call will actually use it.
   *
   * `status` and `q` filter server-side rather than in the browser: a busy
   * graph has thousands of runs and "show me the failures" must not mean
   * "download everything first".
   */
  app.get("/workflows/:graphKey/runs", async (req: any, reply: any) => {
    const orgId = readOrgId(req.headers);
    const graphKey = String(req.params?.graphKey ?? "");
    const status = req.query?.status ? String(req.query.status) : null;
    const search = req.query?.q ? String(req.query.q).trim() : null;
    const limit = Math.min(Number(req.query?.limit ?? 100) || 100, 500);

    if (!graphKey) {
      return reply.code(400).send({ error: "graph_key_required" });
    }

    try {
      return await withOrgScope(pool, orgId, async (client) => {
        const versioned = await graphVersionColumnExists(client);
        const versionSelect = versioned
          ? "r.graph_version"
          : "NULL::int AS graph_version";
        const params: unknown[] = [graphKey, limit];
        let statusPredicate = "";
        if (status && status !== "all") {
          params.push(status);
          statusPredicate = ` AND r.status = $${params.length}`;
        }
        let searchPredicate = "";
        if (search) {
          params.push(`%${search}%`);
          const i = params.length;
          searchPredicate =
            ` AND (r.id::text ILIKE $${i}` +
            ` OR coalesce(o.event_type, '') ILIKE $${i}` +
            ` OR coalesce(r.input_ref->>'correlation_id', '') ILIKE $${i})`;
        }

        const { rows } = await client.query(
          `
          SELECT
            r.id::text                              AS run_id,
            r.graph_key,
            ${versionSelect},
            r.status,
            r.agent_name,
            r.organization_id::text                 AS org_id,
            r.trigger_event_id::text                AS trigger_event_id,
            o.event_type                            AS trigger_event,
            r.input_ref->>'correlation_id'          AS correlation_id,
            r.started_at,
            r.completed_at,
            r.error,
            (SELECT count(*) FROM orch.steps s WHERE s.run_id = r.id) AS step_count,
            (SELECT count(*) FROM ${GRAPH_DEFINITIONS} d
              WHERE d.graph_key = r.graph_key) AS graph_version_count,
            (SELECT min(d.version) FROM ${GRAPH_DEFINITIONS} d
              WHERE d.graph_key = r.graph_key) AS only_version
          FROM orch.runs r
          LEFT JOIN orch.event_outbox o ON o.event_id = r.trigger_event_id
          WHERE r.graph_key = $1${statusPredicate}${searchPredicate}
          ORDER BY r.created_at DESC
          LIMIT $2
          `,
          params,
        );

        const runs: WorkflowRun[] = rows.map((r: any) => {
          const started = r.started_at ? new Date(r.started_at) : null;
          const completed = r.completed_at ? new Date(r.completed_at) : null;

          /**
           * Which version did this run execute?
           *
           * "recorded" — the runtime stored the pin. The only answer that is
           *   a fact rather than an argument.
           * "inferred" — the workflow has only EVER had one version, so a run
           *   of it cannot have used any other. Certain, not a guess.
           * null — the graph has been re-versioned and the pin was not stored.
           *   Deliberately left unknown: showing the currently active version
           *   here would claim a v79 run of something that ran as v3.
           */
          const recorded = r.graph_version ?? null;
          const onlyOne = Number(r.graph_version_count ?? 0) === 1;
          const pinnedVersion =
            recorded ?? (onlyOne ? Number(r.only_version) : null);
          const versionSource: "recorded" | "inferred" | null =
            recorded != null ? "recorded" : onlyOne ? "inferred" : null;

          return {
            runId: r.run_id,
            graphKey: r.graph_key,
            triggerEvent: r.trigger_event ?? null,
            triggerEventId: r.trigger_event_id ?? null,
            orgId: r.org_id ?? null,
            pinnedVersion,
            versionSource,
            status: r.status,
            agentName: r.agent_name ?? null,
            startedAt: started ? started.toISOString() : null,
            completedAt: completed ? completed.toISOString() : null,
            // Only for finished runs. A running one has no duration yet, and
            // now() - started would be a stopwatch, not a fact about the run.
            durationMs:
              started && completed
                ? completed.getTime() - started.getTime()
                : null,
            correlationId: r.correlation_id ?? null,
            error: r.error ?? null,
            stepCount: Number(r.step_count ?? 0),
          };
        });

        // Counts come from the whole table, not the returned page, so the
        // filter chips still say how many failures exist when you are looking
        // at the first hundred of nine hundred runs.
        const { rows: tallies } = await client.query(
          `SELECT status, count(*)::int AS n FROM orch.runs
           WHERE graph_key = $1 GROUP BY status`,
          [graphKey],
        );
        const counts: Record<string, number> = {};
        let total = 0;
        for (const t of tallies as Array<{ status: string; n: number }>) {
          counts[t.status] = t.n;
          total += t.n;
        }

        return { graphKey, runs, counts, total, limit };
      });
    } catch (err) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "runs_query_failed", message: String(err) });
    }
  });

  /**
   * Screen 13 — one run, and the path it actually took.
   *
   * Header and steps in a single call: they are always read together, and two
   * round trips would let the page render a run whose steps have not arrived.
   *
   * THE PATH COMES FROM `orch.steps`, WHICH IS RECORDED EVIDENCE. Every node
   * execution was written as it happened, with its attempt, status, latency
   * and error class. That is why this screen works for runs from months ago
   * and for runs whose graph has been re-authored seventy-nine times since:
   * nothing here is reconstructed from the current topology.
   *
   * Retries appear as separate rows against the same node — six failed
   * attempts of one node are six steps, not one — so the path can show
   * "tried 6 times" rather than flattening it to a single failure.
   */
  app.get("/runs/:runId", async (req: any, reply: any) => {
    const runId = String(req.params?.runId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(runId)) {
      return reply.code(400).send({ error: "invalid_run_id" });
    }
    const orgId = readOrgId(req.headers);

    try {
      return await withOrgScope(pool, orgId, async (client) => {
        const versioned = await graphVersionColumnExists(client);
        const versionSelect = versioned
          ? "r.graph_version"
          : "NULL::int AS graph_version";

        const { rows } = await client.query(
          `
          SELECT
            r.id::text                       AS run_id,
            r.graph_key,
            ${versionSelect},
            r.status,
            r.agent_name,
            r.organization_id::text          AS org_id,
            r.trigger_event_id::text         AS trigger_event_id,
            o.event_type                     AS trigger_event,
            o.payload_ref                    AS trigger_payload,
            r.input_ref->>'correlation_id'   AS correlation_id,
            r.langgraph_thread_id,
            r.started_at, r.completed_at, r.error
          FROM orch.runs r
          LEFT JOIN orch.event_outbox o ON o.event_id = r.trigger_event_id
          WHERE r.id = $1::uuid
          `,
          [runId],
        );

        const row = rows[0] as any;
        if (!row) return reply.code(404).send({ error: "run_not_found", runId });

        const { rows: stepRows } = await client.query(
          `SELECT seq, node, tool_name, status, latency_ms, output_ref, created_at
             FROM orch.steps
            WHERE run_id = $1::uuid
            ORDER BY seq ASC, created_at ASC`,
          [runId],
        );

        const steps = (stepRows as any[]).map((s) => ({
          seq: Number(s.seq ?? 0),
          node: s.node as string,
          tool: (s.tool_name ?? null) as string | null,
          status: s.status as string,
          latencyMs: s.latency_ms == null ? null : Number(s.latency_ms),
          output: (s.output_ref ?? null) as Record<string, unknown> | null,
          at: s.created_at ? new Date(s.created_at).toISOString() : null,
        }));

        /**
         * The executed path: one entry per node, in the order first reached,
         * carrying every attempt against it.
         *
         * Grouped rather than listed flat because "this node ran six times"
         * is the fact a person needs; six identical rows makes them count.
         */
        const path: Array<{
          node: string;
          tool: string | null;
          attempts: number;
          status: string;
          totalLatencyMs: number;
          firstAt: string | null;
          errorClass: string | null;
        }> = [];
        for (const s of steps) {
          let entry = path.find((p) => p.node === s.node);
          if (!entry) {
            entry = {
              node: s.node,
              tool: s.tool,
              attempts: 0,
              status: s.status,
              totalLatencyMs: 0,
              firstAt: s.at,
              errorClass: null,
            };
            path.push(entry);
          }
          entry.attempts += 1;
          entry.totalLatencyMs += s.latencyMs ?? 0;
          // The LAST attempt is the node's outcome: a node that failed twice
          // and then succeeded did, in the end, succeed.
          entry.status = s.status;
          const ec = (s.output as { errorClass?: unknown } | null)?.errorClass;
          entry.errorClass = typeof ec === "string" ? ec : entry.errorClass;
        }

        const started = row.started_at ? new Date(row.started_at) : null;
        const completed = row.completed_at ? new Date(row.completed_at) : null;

        return {
          run: {
            runId: row.run_id,
            graphKey: row.graph_key,
            pinnedVersion: row.graph_version ?? null,
            status: row.status,
            agentName: row.agent_name ?? null,
            orgId: row.org_id ?? null,
            triggerEvent: row.trigger_event ?? null,
            triggerEventId: row.trigger_event_id ?? null,
            triggerPayload: row.trigger_payload ?? null,
            correlationId: row.correlation_id ?? null,
            threadId: row.langgraph_thread_id ?? null,
            startedAt: started ? started.toISOString() : null,
            completedAt: completed ? completed.toISOString() : null,
            durationMs:
              started && completed
                ? completed.getTime() - started.getTime()
                : null,
            error: row.error ?? null,
          },
          path,
          steps,
        };
      });
    } catch (err) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "run_query_failed", message: String(err) });
    }
  });
}
