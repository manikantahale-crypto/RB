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
import { orderSteps } from "../lib/outline-order.js";
import { collectGateEvidence } from "../lib/gate-evidence.js";
import { evaluateGoLiveGate } from "@tekisho/authoring";
import { previewRelease, type StoredBinding } from "../lib/release-preview.js";
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
  /**
   * The lifecycle, read from the authoring tables rather than the view.
   *
   * GRAPH_DEFINITIONS maps both a numbered `compiled` build and the unnumbered
   * working copy to 'draft', which is right for anything that only wants to
   * know "is this live". It is not enough to drive the lifecycle: "you have
   * unsaved edits" and "you have a build waiting to be sent for review" are
   * different sentences with different buttons under them.
   */
  lifecycle: {
    /** There is a working copy to compile. */
    hasWorkingCopy: boolean;
    /** Highest compiled version, ready to be requested. */
    compiledVersion: number | null;
    /** Version awaiting somebody's approval. */
    pendingVersion: number | null;
  };
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
            -- Straight from authoring, because the view cannot tell a compiled
            -- build from an unsaved edit and the buttons differ.
            (
              SELECT count(*) > 0 FROM authoring.graph_drafts gd
              JOIN authoring.graphs gg ON gg.id = gd.graph_id
              WHERE gg.graph_key = d.graph_key
            ) AS has_working_copy,
            (
              SELECT max(v.version) FROM authoring.graph_versions v
              JOIN authoring.graphs gg ON gg.id = v.graph_id
              WHERE gg.graph_key = d.graph_key AND v.status = 'compiled'
            ) AS compiled_version,
            (
              SELECT max(v.version) FROM authoring.graph_versions v
              JOIN authoring.graphs gg ON gg.id = v.graph_id
              WHERE gg.graph_key = d.graph_key AND v.status = 'pending_go_live'
            ) AS pending_version,
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
              WHERE r.graph_key = d.graph_key AND r.status = 'PARKED'
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
            lifecycle: {
              hasWorkingCopy: Boolean(r.has_working_copy),
              compiledVersion:
                r.compiled_version == null ? null : Number(r.compiled_version),
              pendingVersion:
                r.pending_version == null ? null : Number(r.pending_version),
            },
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
  /**
   * Screen 10 — what is waiting for an approver.
   *
   * THE REQUEST EXISTED AND THE QUEUE DID NOT.
   *
   * `POST /workflows/:key/request-go-live` has moved a compiled build to
   * `pending_go_live` since V20260909.48, and `approve-go-live` has promoted
   * it. Both are reachable only from inside one workflow's editor, so a
   * request could be made and then seen by nobody: an approver had no screen
   * answering "what is waiting for me". The two-person rule was enforced
   * (`graph_versions_two_person_ck`) and simultaneously unusable, because the
   * second person had no way to find the thing they were required to approve.
   *
   * WHY EACH ROW CARRIES THE LIVE VERSION TOO.
   *
   * Approving replaces what is running. An approver deciding from the request
   * alone is deciding from half the picture — "v7 of syntra.jd.workflow" says
   * nothing about whether v6 has been live for a year or went up an hour ago.
   * So each row names what it would replace, and the screen links to the diff
   * between the two.
   *
   * `requested_by` comes back as text rather than a uuid because that is what
   * the column holds for most rows: `attribution()` writes a uuid for a known
   * user and a free-text label otherwise, and several hundred existing rows
   * are deployment labels like `stage-v31-relay`.
   */
  app.get("/workflows/pending-go-live", async (req: any, reply: any) => {
    const orgId = readOrgId(req.headers);

    try {
      return await withOrgScope(pool, orgId, async (client) => {
        const { rows } = await client.query(
          `
          SELECT g.graph_key,
                 v.version,
                 v.checksum,
                 v.requested_at,
                 coalesce(v.requested_by::text, v.requested_by_label) AS requested_by,
                 v.request_note,
                 v.compiled_at,
                 coalesce(v.compiled_by::text, v.compiled_by_label)   AS compiled_by,
                 live.version     AS live_version,
                 live.compiled_at AS live_since,
                 (
                   SELECT coalesce(array_agg(DISTINCT b.event_type), '{}')
                     FROM ${GRAPH_EVENT_BINDINGS} b
                    WHERE b.graph_key = g.graph_key AND b.status = 'active'
                 ) AS triggers,
                 -- The trigger the definition CHOSE, which is not the same as
                 -- a binding. A binding is created at go-live, not before, so
                 -- a pending version has none by design — reading bindings
                 -- alone reports every row on this screen as unreachable and
                 -- the warning becomes noise.
                 --
                 -- TWO NAMES, BOTH REAL. entryInput is what the seeds and the
                 -- older definitions carry (6 of 527 versions in the new
                 -- project); triggerEventType is what the graph contract added
                 -- and what /workflows/accept writes today. Neither name
                 -- appears in both sets, so reading one finds nothing for
                 -- everything authored by the other.
                 coalesce(v.definition->>'triggerEventType',
                          v.definition->>'entryInput') AS chosen_trigger,
                 jsonb_array_length(coalesce(v.definition->'nodes', '[]'::jsonb)) AS step_count
            FROM authoring.graph_versions v
            JOIN authoring.graphs g ON g.id = v.graph_id
            LEFT JOIN LATERAL (
              SELECT v2.version, v2.compiled_at
                FROM authoring.graph_versions v2
               WHERE v2.graph_id = v.graph_id AND v2.status = 'live'
               LIMIT 1
            ) live ON true
           WHERE v.status = 'pending_go_live'
             AND g.org_id IS NOT DISTINCT FROM $1::uuid
           ORDER BY v.requested_at ASC NULLS LAST, g.graph_key ASC
          `,
          [orgId],
        );

        return {
          requests: rows.map((r: any) => ({
            graphKey: r.graph_key,
            module: moduleOf(r.graph_key),
            version: Number(r.version),
            checksum: r.checksum ?? null,
            requestedAt: r.requested_at
              ? new Date(r.requested_at).toISOString()
              : null,
            requestedBy: r.requested_by ?? null,
            /** What the author said they changed. The approver is never them. */
            requestNote: r.request_note ?? null,
            compiledAt: r.compiled_at
              ? new Date(r.compiled_at).toISOString()
              : null,
            compiledBy: r.compiled_by ?? null,
            /** What approving would replace. Null when nothing is live yet. */
            liveVersion: r.live_version == null ? null : Number(r.live_version),
            liveSince: r.live_since ? new Date(r.live_since).toISOString() : null,
            /**
             * What will start it, whether that is already bound or is about
             * to be. `triggerSource` says which, because the distinction is
             * real: `binding` means events reach the workflow today, `draft`
             * means the binding is created when this is approved.
             */
            triggers:
              ((r.triggers ?? []) as string[]).length > 0
                ? (r.triggers as string[])
                : r.chosen_trigger
                  ? [String(r.chosen_trigger)]
                  : [],
            triggerSource:
              ((r.triggers ?? []) as string[]).length > 0
                ? ("binding" as const)
                : r.chosen_trigger
                  ? ("draft" as const)
                  : ("none" as const),
            stepCount: Number(r.step_count ?? 0),
            /**
             * Nothing will start it, even after approval — no binding now and
             * no trigger chosen in the definition. It would go live and never
             * run, which is the one failure this screen can catch before it
             * happens rather than after.
             */
            unreachable:
              ((r.triggers ?? []) as string[]).length === 0 && !r.chosen_trigger,
          })),
          orgId,
        };
      });
    } catch (err) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "pending_query_failed", message: String(err) });
    }
  });
  /**
   * What this workflow IS, at a glance, for the top of its history page.
   *
   * THE QUESTION THIS ANSWERS IS "IS THIS THE ONE I WANT".
   *
   * Somebody looking at a list of runs has usually arrived from a search and
   * needs to know what the workflow does before deciding whether to read any
   * of them. Opening a run to find that out is the wrong way round: a run page
   * carries logs, per-node input and output and timings, all of which are
   * about one execution rather than about the workflow.
   *
   * So this is deliberately small. Order of the steps, what each one is, what
   * starts it, which version is live. No payloads, no timings, no per-run
   * anything — those already have a screen, and putting them here would make
   * the history page the cluttered thing it is meant to save people from.
   *
   * WHY THE SERVER FLATTENS IT RATHER THAN SENDING THE DEFINITION.
   *
   * A definition is nodes plus edges plus conditionalEdges, and turning that
   * into "first this, then this, and here it splits three ways" is a topological
   * sort. Doing it in the browser would mean shipping the whole definition —
   * configs, input mappings and all — to draw a strip of five names, and every
   * screen that wanted the same summary would implement the sort again.
   *
   * Falls back to the newest version when nothing is live, because a workflow
   * with runs and no live version is exactly the case somebody is investigating.
   */
  app.get("/workflows/:graphKey/outline", async (req: any, reply: any) => {
    const graphKey = String(req.params?.graphKey ?? "");
    if (!graphKey) return reply.code(400).send({ error: "graph_key_required" });
    const orgId = readOrgId(req.headers);

    try {
      return await withOrgScope(pool, orgId, async (client) => {
        const { rows } = await client.query(
          `
          SELECT v.version, v.status, v.definition, v.compiled_at
            FROM authoring.graph_versions v
            JOIN authoring.graphs g ON g.id = v.graph_id
           WHERE g.graph_key = $1
             AND g.org_id IS NOT DISTINCT FROM $2::uuid
           ORDER BY (v.status = 'live') DESC, v.version DESC
           LIMIT 1
          `,
          [graphKey, orgId],
        );

        const row = rows[0] as any;
        if (!row) {
          return reply
            .code(404)
            .send({ error: "workflow_not_found", graphKey });
        }

        const definition = (row.definition ?? {}) as {
          nodes?: Array<{ id?: string; impl?: string }>;
          edges?: Array<[string, string]>;
          conditionalEdges?: Array<{
            from?: string;
            router?: string;
            map?: Record<string, string>;
          }>;
          triggerEventType?: string;
          entryInput?: string;
        };

        const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];
        const edges = Array.isArray(definition.edges) ? definition.edges : [];
        const conditional = Array.isArray(definition.conditionalEdges)
          ? definition.conditionalEdges
          : [];

        // The order somebody reads the workflow in, which is not the order the
        // nodes are stored in. See lib/outline-order.ts — it is tested there
        // against the shapes this actually has to survive.
        const known = new Map(nodes.map((n) => [String(n.id ?? ""), n]));
        const ordered = orderSteps(definition);

        /** Which steps fan out, and into what. This is the shape of the flow. */
        const branchOf = new Map<string, string[]>();
        for (const c of conditional) {
          branchOf.set(String(c.from ?? ""), Object.keys(c.map ?? {}));
        }

        /**
         * The connections, so the caller can DRAW the workflow rather than
         * list it.
         *
         * A list of steps in order is a lie about a branching workflow: three
         * arms that each do something different read as three consecutive
         * steps. These carry the arm name as a label, which is the only thing
         * that says which way the flow went and why.
         *
         * `__start__` and `__end__` come through as edges but not as steps.
         * They are where the flow enters and leaves, and dropping the edges
         * would leave the first and last steps looking unconnected.
         */
        const drawnEdges: Array<{ from: string; to: string; label: string | null }> =
          [];
        const seenEdge = new Set<string>();
        const pushEdge = (from: string, to: string, label: string | null) => {
          if (!from || !to) return;
          // Two arms of one branch can lead to the same place — both ending
          // the workflow is the usual case — and they are different edges.
          const sig = `${from} ${to} ${label ?? ""}`;
          if (seenEdge.has(sig)) return;
          seenEdge.add(sig);
          drawnEdges.push({ from, to, label });
        };
        for (const [from, to] of edges) pushEdge(String(from), String(to), null);
        for (const c of conditional) {
          for (const [arm, target] of Object.entries(c.map ?? {})) {
            pushEdge(String(c.from ?? ""), String(target), arm);
          }
        }

        const implKeys = [
          ...new Set(nodes.map((n) => String(n.impl ?? "")).filter(Boolean)),
        ];
        const { rows: contracts } = implKeys.length
          ? await client.query(
              `SELECT key, title, side_effect FROM authoring.node_registry
                WHERE key = ANY($1::text[])`,
              [implKeys],
            )
          : { rows: [] as any[] };
        const contractOf = new Map(
          (contracts as any[]).map((c) => [c.key, c]),
        );

        const bound = await client.query(
          `SELECT DISTINCT b.event_type FROM ${GRAPH_EVENT_BINDINGS} b
            WHERE b.graph_key = $1 AND b.status = 'active'`,
          [graphKey],
        );
        const triggers = (bound.rows as any[]).map((b) => b.event_type);
        const chosen =
          definition.triggerEventType ?? definition.entryInput ?? null;

        return {
          graphKey,
          version: Number(row.version),
          status: String(row.status),
          live: row.status === "live",
          compiledAt: row.compiled_at
            ? new Date(row.compiled_at).toISOString()
            : null,
          triggers: triggers.length > 0 ? triggers : chosen ? [String(chosen)] : [],
          triggerSource:
            triggers.length > 0 ? "binding" : chosen ? "draft" : "none",
          /** How many places the flow splits — a fact about the shape. */
          branchCount: branchOf.size,
          edges: drawnEdges,
          steps: ordered.map((id) => {
            const node = known.get(id)!;
            const impl = String(node.impl ?? "");
            const contract = contractOf.get(impl);
            return {
              id,
              impl,
              /** The human name from the registry, when the node declares one. */
              title: contract?.title ?? null,
              /** external / internal_write / read_only — drawn as a dot. */
              sideEffect: contract?.side_effect ?? null,
              /** Present on a step that splits: the names of its outcomes. */
              outcomes: branchOf.get(id) ?? null,
              /** The node registry has never heard of this impl. */
              unknown: !contract,
            };
          }),
        };
      });
    } catch (err) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "outline_failed", message: String(err) });
    }
  });
  /**
   * Screen 10 — everything the approver needs, in one call.
   *
   * The queue can say a version is waiting and who asked for it. It cannot say
   * what pressing the button does, and that is the only thing the person
   * pressing it needs. Four facts answer it, and they were spread across three
   * endpoints and one screen that showed none of them:
   *
   *   the version   what it is, what it does, who asked, when
   *   the evidence  all nine go-live checks, run now rather than at the gate
   *   the change    what it replaces, and how the two differ
   *   the routing   which events move, computed by the router's own resolver
   *
   * ONE CALL, because they are read together and four round trips would let
   * the page render a decision from a version that has since been approved by
   * somebody else.
   *
   * The checks run HERE rather than only at approval. A gate that first speaks
   * when you press the button turns a review into a retry loop; the same
   * evaluation shown beforehand is the difference between "approve and find
   * out" and "approve".
   */
  app.get("/workflows/:graphKey/release", async (req: any, reply: any) => {
    const graphKey = String(req.params?.graphKey ?? "");
    if (!graphKey) return reply.code(400).send({ error: "graph_key_required" });
    const orgId = readOrgId(req.headers);

    try {
      return await withOrgScope(pool, orgId, async (client) => {
        const { rows: pending } = await client.query(
          `SELECT v.version, v.definition, v.checksum,
                  v.requested_at, v.compiled_at,
                  coalesce(v.requested_by::text, v.requested_by_label) AS requested_by,
                  v.request_note,
                  coalesce(v.compiled_by::text, v.compiled_by_label)   AS compiled_by
             FROM authoring.graph_versions v
             JOIN authoring.graphs g ON g.id = v.graph_id
            WHERE g.graph_key = $1
              AND g.org_id IS NOT DISTINCT FROM $2::uuid
              AND v.status = 'pending_go_live'
            ORDER BY v.requested_at ASC NULLS LAST
            LIMIT 1`,
          [graphKey, orgId],
        );

        const row = pending[0] as any;
        if (!row) {
          return reply.code(404).send({
            error: "nothing_waiting",
            message: `${graphKey} has no version waiting for approval.`,
          });
        }

        const { rows: liveRows } = await client.query(
          `SELECT v.version, v.definition, v.compiled_at
             FROM authoring.graph_versions v
             JOIN authoring.graphs g ON g.id = v.graph_id
            WHERE g.graph_key = $1
              AND g.org_id IS NOT DISTINCT FROM $2::uuid
              AND v.status = 'live'
            LIMIT 1`,
          [graphKey, orgId],
        );
        const live = liveRows[0] as any;

        /**
         * The trigger, under either of the two names a definition may use.
         * `entryInput` is what the seeds carry; `triggerEventType` is what the
         * current create path writes, and no definition has both.
         */
        const def = (row.definition ?? {}) as any;
        const trigger: string | null =
          def.triggerEventType ?? def.entryInput ?? null;

        /* ── the evidence ──────────────────────────────────────────────── */
        const artifactSource = `${JSON.stringify(row.definition, null, 2)}\n`;
        const evidence = await collectGateEvidence(client, artifactSource, graphKey);
        const gate = evaluateGoLiveGate({
          artifactSource,
          storedChecksum: row.checksum ?? "",
          expectedGraphKey: graphKey,
          artifactKind: "workflow",
          // Looking is not requesting. The gap acknowledgement belongs to the
          // request, and reporting it unacknowledged is the point of looking.
          gapAck: null,
          ...evidence,
        });

        /* ── the routing ───────────────────────────────────────────────── */
        const { rows: bindingRows } = await client.query(
          `SELECT b.id::text AS id, b.event_type, b.org_id::text AS org_id,
                  g.graph_key, b.queue_key, b.consuming_application,
                  b.priority, b.requires_feature, b.status
             FROM authoring.event_bindings b
             JOIN authoring.graphs g ON g.id = b.graph_id
            WHERE b.event_type = $1`,
          [trigger],
        );

        const stored: StoredBinding[] = (bindingRows as any[]).map((b) => ({
          id: String(b.id),
          eventType: String(b.event_type),
          orgId: b.org_id ?? null,
          graphKey: String(b.graph_key),
          queueKey: b.queue_key ?? null,
          consumingApplication: b.consuming_application ?? null,
          priority: b.priority ?? null,
          requiresFeature: Array.isArray(b.requires_feature)
            ? b.requires_feature
            : null,
          status: String(b.status),
        }));

        const application = graphKey.split(".")[0] ?? "platform";
        const routing = trigger
          ? previewRelease({
              eventType: trigger,
              orgId,
              current: stored,
              approving: {
                id: "(this release)",
                eventType: trigger,
                orgId,
                graphKey,
                queueKey: null,
                consumingApplication: application,
                priority: 100,
                requiresFeature: null,
                status: "active",
              },
            })
          : null;

        const steps = Array.isArray(def.nodes) ? def.nodes : [];

        return {
          graphKey,
          version: Number(row.version),
          checksum: row.checksum ?? null,
          requestedAt: row.requested_at
            ? new Date(row.requested_at).toISOString()
            : null,
          requestedBy: row.requested_by ?? null,
          requestNote: row.request_note ?? null,
          compiledAt: row.compiled_at
            ? new Date(row.compiled_at).toISOString()
            : null,
          compiledBy: row.compiled_by ?? null,
          trigger,
          steps: steps.map((n: any) => ({
            id: String(n?.id ?? ""),
            impl: String(n?.impl ?? ""),
          })),
          /** What this would replace. Null when nothing is live yet. */
          replaces: live
            ? {
                version: Number(live.version),
                since: live.compiled_at
                  ? new Date(live.compiled_at).toISOString()
                  : null,
                stepCount: Array.isArray(live.definition?.nodes)
                  ? live.definition.nodes.length
                  : 0,
              }
            : null,
          /**
           * Every check, passing ones included. A console that lists only
           * failures cannot be read as "this was reviewed" — the approver has
           * no way to tell a clean run from a check that did not execute.
           */
          checks: gate.checks.map((c) => ({
            id: c.id,
            ok: c.ok,
            message: c.message,
            /** A check that could not see says so, and is not a pass. */
            unchecked: c.ok && /^Not checked/i.test(c.message),
          })),
          blocked: !gate.ok,
          blockedBy: gate.ok ? [] : gate.blockedBy,
          routing,
        };
      });
    } catch (err) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "release_view_failed", message: String(err) });
    }
  });
}
