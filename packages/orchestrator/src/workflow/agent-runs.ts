/**
 * Run audit spine:
 * 1. orchestration_runs / orchestration_steps — always writable by migrator (demo)
 * 2. agent_runs / agent_steps — RETIRED. See the note in startAgentRun.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import type { RunStatus } from './run-status.js';

/** See run-status.ts — PARKED is the one word for a run waiting on a person. */
export type AgentRunStatus = RunStatus;

export type AgentStepStatus = 'OK' | 'RETRIED' | 'FAILED' | 'SKIPPED';

const FALLBACK_AGENT: Record<string, string> = {
  'matching-agent': '01900000-0000-7000-8000-000000000501',
  'intake-agent': '01900000-0000-7000-8000-000000000502',
};

let auditTablesReady: Promise<void> | null = null;

/** Orch-owned audit tables in schema `orch` (avoids shared-table ownership fights). */
export async function ensureOrchAuditTables(pool: Pool): Promise<void> {
  if (!auditTablesReady) {
    auditTablesReady = (async () => {
      // The schema and its tables are built by packages/db/migrations, not
      // here. This used to CREATE SCHEMA and CREATE TABLE IF NOT EXISTS on
      // every worker boot, which made the engine an author of the schema
      // alongside the migrations — and they had already drifted: orch.steps
      // gained org_id and attempt in V20260909.12, which this definition never
      // knew about. A boot against a fresh database would have created the
      // older shape, silently, and everything after would have been wrong.
      const { rows } = await pool.query<{ missing: string | null }>(
        `SELECT CASE
                  WHEN to_regnamespace('orch') IS NULL     THEN 'schema orch'
                  WHEN to_regclass('orch.runs')  IS NULL   THEN 'orch.runs'
                  WHEN to_regclass('orch.steps') IS NULL   THEN 'orch.steps'
                  ELSE NULL
                END AS missing`,
      );
      if (rows[0]?.missing) {
        throw new Error(
          `[orch] ${rows[0].missing} is missing. Apply packages/db/migrations ` +
            `before starting the worker; verify with scripts/rebuild-check.sh.`,
        );
      }
    })().catch((err) => {
      auditTablesReady = null;
      throw err;
    });
  }
  await auditTablesReady;
}

function isPermissionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /permission denied|does not exist|violates/i.test(msg);
}

export async function resolveAgentDefinitionId(
  pool: Pool,
  agentName: string,
): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id::text AS id FROM builder.agent_definitions
       WHERE name = $1 AND is_active = true
       LIMIT 1`,
      [agentName],
    );
    if (rows[0]?.id) return rows[0].id;
  } catch (err) {
    if (!isPermissionError(err)) {
      console.warn('[agent_runs] resolveAgentDefinitionId:', err);
    }
  }
  return FALLBACK_AGENT[agentName] ?? FALLBACK_AGENT['intake-agent'] ?? null;
}

/**
 * What a claim on (event, workflow) came to.
 *
 *   started    no run existed; this delivery owns the new one
 *   restarted  a FAILED / RUNNING / QUEUED attempt existed; this delivery
 *              takes it over (pg-boss retry, or a worker that died mid-run)
 *   settled    the run already COMPLETED, PARKED, CANCELLED or EXPIRED — this
 *              delivery is a duplicate and must NOT run the graph
 *   unrecorded the audit write failed; run anyway, as before (fail-open)
 */
export type RunClaim =
  | { kind: 'started'; runId: string }
  | { kind: 'restarted'; runId: string }
  | { kind: 'settled'; runId: string; status: string }
  | { kind: 'unrecorded' };

/**
 * Claim the run for this event and workflow — one statement, one answer.
 *
 * This used to be a SELECT and then an INSERT or an UPDATE: two workers
 * given the same event could both read "no run" and both insert, and a run
 * that had COMPLETED was restarted on redelivery as if it had not. The
 * unique index from V20260909.73 makes (trigger_event_id, graph_key) a
 * fact, and ON CONFLICT ... WHERE turns the fact into a decision: take over
 * an attempt that failed or is running, decline one that is done.
 *
 * The other branch keeps a separate `processed_events` table for this. The
 * run row already is that record; it only had to be unique.
 */
export async function claimRun(args: {
  pool: Pool;
  organizationId: string;
  agentName: string;
  triggerEventId: string;
  graphKey: string;
  /** The version this run is pinned to, from the router's decision. */
  graphVersion?: number | null;
  langgraphThreadId: string;
  inputRef?: Record<string, unknown>;
}): Promise<RunClaim> {
  const defId = await resolveAgentDefinitionId(args.pool, args.agentName);
  const inputJson = JSON.stringify({
    graph_key: args.graphKey,
    agent_name: args.agentName,
    langgraph_thread_id: args.langgraphThreadId,
    ...(args.inputRef ?? {}),
  });

  try {
    await ensureOrchAuditTables(args.pool);
    const { rows } = await args.pool.query<{ id: string; inserted: boolean }>(
      `INSERT INTO orch.runs (
         id, organization_id, agent_name, agent_definition_id, trigger_event_id,
         graph_key, graph_version, status, langgraph_thread_id, input_ref,
         started_at, heartbeat_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'RUNNING',$8,$9::jsonb, now(), now())
       ON CONFLICT (trigger_event_id, graph_key) WHERE trigger_event_id IS NOT NULL
       DO UPDATE
         SET status = 'RUNNING',
             started_at = COALESCE(orch.runs.started_at, now()),
             heartbeat_at = now(),
             /**
              * A run that is running has not completed: both cleared, as
              * the old restart path did, for the reason it gave — a finished
              * run brought back to life carrying its old completion time is
              * a state nothing can explain.
              */
             completed_at = NULL,
             error = NULL,
             graph_version = COALESCE(EXCLUDED.graph_version, orch.runs.graph_version)
       WHERE orch.runs.status IN ('QUEUED', 'RUNNING', 'FAILED')
       RETURNING id::text AS id, (xmax = 0) AS inserted`,
      [
        randomUUID(),
        args.organizationId,
        args.agentName,
        defId,
        args.triggerEventId,
        args.graphKey,
        args.graphVersion ?? null,
        args.langgraphThreadId,
        inputJson,
      ],
    );
    const row = rows[0];
    if (row) {
      console.log(
        `[orch_runs] ${row.inserted ? 'STARTED' : 'restarted'} run=${row.id} agent=${args.agentName} graph=${args.graphKey} event=${args.triggerEventId}`,
      );
      return { kind: row.inserted ? 'started' : 'restarted', runId: row.id };
    }

    // No row back: the conflict target exists and its status was not one we
    // take over. Read it so the caller can say why the delivery is declined.
    const { rows: settled } = await args.pool.query<{ id: string; status: string }>(
      `SELECT id::text AS id, status FROM orch.runs
        WHERE trigger_event_id = $1 AND graph_key = $2`,
      [args.triggerEventId, args.graphKey],
    );
    const done = settled[0];
    if (done) return { kind: 'settled', runId: done.id, status: done.status };
    return { kind: 'unrecorded' };
  } catch (err) {
    console.warn(
      `[orch_runs] claim failed (fail-open):`,
      err instanceof Error ? err.message : err,
    );
    return { kind: 'unrecorded' };
  }
}

/**
 * The old entry point: claim, and answer with the run id or null. Kept for
 * callers that only want the id; the runner uses `claimRun` because it has
 * to know when NOT to run.
 */
export async function startAgentRun(
  args: Parameters<typeof claimRun>[0],
): Promise<string | null> {
  const claim = await claimRun(args);
  return claim.kind === 'unrecorded' ? null : claim.runId;
}

export async function finishAgentRun(args: {
  pool: Pool;
  organizationId: string;
  runId: string;
  status: Extract<AgentRunStatus, 'COMPLETED' | 'FAILED' | 'PARKED' | 'CANCELLED'>;
  error?: { message: string; errorClass?: string };
}): Promise<void> {
  const errJson = args.error
    ? JSON.stringify({
        message: args.error.message,
        error_class: args.error.errorClass ?? null,
      })
    : null;

  try {
    await ensureOrchAuditTables(args.pool);
    await args.pool.query(
      `UPDATE orch.runs
       SET status = $2,
           completed_at = CASE WHEN $2 IN ('COMPLETED','FAILED','CANCELLED','EXPIRED')
             THEN now() ELSE completed_at END,
           error = COALESCE($3::jsonb, error)
       WHERE id = $1`,
      [args.runId, args.status, errJson],
    );
    console.log(`[orch_runs] ${args.status} run=${args.runId}`);
  } catch (err) {
    console.warn(
      `[orch_runs] finish failed (fail-open):`,
      err instanceof Error ? err.message : err,
    );
  }

}

export async function recordAgentStep(args: {
  pool: Pool;
  organizationId: string;
  runId: string;
  node: string;
  status: AgentStepStatus;
  latencyMs?: number;
  toolName?: string;
  outputRef?: Record<string, unknown>;
  input?: Record<string, unknown>;
}): Promise<void> {
  try {
    await ensureOrchAuditTables(args.pool);
    const seqRes = await args.pool.query<{ seq: number }>(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS seq
       FROM orch.steps WHERE run_id = $1`,
      [args.runId],
    );
    const seq = seqRes.rows[0]?.seq ?? 1;
    /**
     * `org_id` IS IN THE COLUMN LIST NOW, AND IT WAS NOT.
     *
     * This function has always taken `organizationId` and never written it.
     * That was harmless until the column became `NOT NULL` in the tenancy
     * work, and then every insert began failing — caught by the fail-open
     * catch below, logged as a warning, and otherwise invisible.
     *
     * Measured: the last step row landed 2026-09-09, and 250 runs have
     * happened since with no steps recorded at all. Run detail has been empty
     * for every one of them, and nothing said so louder than a console warning
     * nobody was reading.
     *
     * Fail-open is still right here — a step we could not record must not kill
     * a run that worked — but it is exactly why this survived. Something that
     * silently degrades needs the check, not the catch.
     */
    await args.pool.query(
      `INSERT INTO orch.steps (
         id, run_id, org_id, seq, node, tool_name, input, output_ref,
         latency_ms, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)`,
      [
        randomUUID(),
        args.runId,
        args.organizationId,
        seq,
        args.node,
        args.toolName ?? null,
        args.input ? JSON.stringify(args.input) : null,
        args.outputRef ? JSON.stringify(args.outputRef) : null,
        args.latencyMs ?? null,
        args.status,
      ],
    );
  } catch (err) {
    console.warn(
      `[orch_steps] record failed (fail-open):`,
      err instanceof Error ? err.message : err,
    );
  }
}

/** Trace helpers for API / smoke. */
export async function loadTraceByEventId(
  pool: Pool,
  eventId: string,
): Promise<{
  outbox: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
  steps: Array<Record<string, unknown>>;
  warnings: string[];
}> {
  const warnings: string[] = [];

  const outbox = await pool.query(
    `SELECT event_id, event_type, organization_id, correlation_id,
            aggregate_type, aggregate_id, producer, payload_ref,
            occurred_at, published_at, causation_id
     FROM orch.event_outbox
     WHERE event_id::text = $1
        OR causation_id::text = $1
        OR (
          correlation_id::text = (
            SELECT correlation_id::text FROM orch.event_outbox
            WHERE event_id::text = $1 LIMIT 1
          )
          AND (event_id::text = $1 OR producer = 'orchestrator')
        )
     ORDER BY occurred_at ASC NULLS LAST`,
    [eventId],
  );

  let runs: Array<Record<string, unknown>> = [];
  try {
    const r = await pool.query(
      `SELECT id, organization_id, agent_definition_id, trigger_event_id,
              status, thread_id, input_ref, error, started_at, completed_at, created_at
       FROM agent_runs
       WHERE trigger_event_id::text = $1
       ORDER BY created_at ASC`,
      [eventId],
    );
    runs = r.rows.map((row) => ({ ...row, source: 'agent_runs' }));
  } catch (err) {
    warnings.push(
      `agent_runs unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    await ensureOrchAuditTables(pool);
    const orchRuns = await pool.query(
      `SELECT id, organization_id, agent_name, trigger_event_id, graph_key,
              status, langgraph_thread_id, error, started_at, completed_at, created_at
       FROM orch.runs
       WHERE trigger_event_id::text = $1
       ORDER BY created_at ASC`,
      [eventId],
    );
    runs = [
      ...runs,
      ...orchRuns.rows.map((row) => ({ ...row, source: 'orch.runs' })),
    ];
  } catch (err) {
    warnings.push(
      `orch.runs unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const runIds = runs
    .map((r) => r.id)
    .filter((id): id is string => typeof id === 'string');
  let steps: Array<Record<string, unknown>> = [];
  if (runIds.length > 0) {
    try {
      const r = await pool.query(
        `SELECT id, agent_run_id, seq, node, tool_name, status, latency_ms,
                output_ref, created_at
         FROM agent_steps
         WHERE agent_run_id = ANY($1::uuid[])
         ORDER BY agent_run_id, seq`,
        [runIds],
      );
      steps = r.rows.map((row) => ({ ...row, source: 'agent_steps' }));
    } catch {
      /* ignore */
    }
    try {
      const orchSteps = await pool.query(
        `SELECT id, run_id AS agent_run_id, seq, node, tool_name, status, latency_ms,
                output_ref, created_at
         FROM orch.steps
         WHERE run_id = ANY($1::uuid[])
         ORDER BY run_id, seq`,
        [runIds],
      );
      steps = [
        ...steps,
        ...orchSteps.rows.map((row) => ({
          ...row,
          source: 'orch.steps',
        })),
      ];
    } catch {
      /* ignore */
    }
  }

  return {
    outbox: outbox.rows,
    runs,
    steps,
    warnings,
  };
}
