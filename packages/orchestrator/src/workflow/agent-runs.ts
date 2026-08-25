/**
 * Run audit spine:
 * 1. orchestration_runs / orchestration_steps — always writable by migrator (demo)
 * 2. agent_runs / agent_steps — design tables (fail-open on GRANT / RLS)
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { withOrgConnection } from '../db/with-org-connection.js';

export type AgentRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING_APPROVAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED';

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
      await pool.query(`CREATE SCHEMA IF NOT EXISTS orch`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS orch.runs (
          id                   uuid PRIMARY KEY,
          organization_id      uuid NOT NULL,
          agent_name           text NOT NULL,
          trigger_event_id     uuid,
          graph_key            text NOT NULL,
          status               text NOT NULL,
          langgraph_thread_id  text,
          input_ref            jsonb NOT NULL DEFAULT '{}',
          error                jsonb,
          started_at           timestamptz,
          completed_at         timestamptz,
          created_at           timestamptz NOT NULL DEFAULT now()
        )
      `);
      /**
       * The version this run is pinned to.
       *
       * Added after the fact, which is why it is an ALTER rather than part of
       * the CREATE above — existing databases already have this table and
       * there is no migration runner in this repository.
       *
       * It matters more than a display column: a run finishes on the version
       * it started with, and run detail is required to draw the topology of
       * THAT version rather than whatever is active now. Without this stored,
       * a v3 run gets redrawn as v5 the moment v5 ships, and the audit trail
       * quietly describes something that never happened. The runtime already
       * knew the number — it pinned it to compile the graph — and then threw
       * it away.
       *
       * Null on rows written before this existed. Nothing back-fills them;
       * the version they ran is genuinely not recoverable.
       */
      await pool.query(`
        ALTER TABLE orch.runs ADD COLUMN IF NOT EXISTS graph_version int
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS orch_runs_trigger_idx
          ON orch.runs (trigger_event_id)
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS orch.steps (
          id          uuid PRIMARY KEY,
          run_id      uuid NOT NULL REFERENCES orch.runs (id) ON DELETE CASCADE,
          seq         int  NOT NULL,
          node        text NOT NULL,
          tool_name   text,
          input       jsonb,
          output_ref  jsonb,
          latency_ms  int,
          status      text NOT NULL,
          created_at  timestamptz NOT NULL DEFAULT now(),
          UNIQUE (run_id, seq)
        )
      `);
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
      `SELECT id::text AS id FROM agent_definitions
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
 * Start an audit run. Returns orchestration_runs.id (used for steps + state.agent_run_id).
 */
export async function startAgentRun(args: {
  pool: Pool;
  organizationId: string;
  agentName: string;
  triggerEventId: string;
  graphKey: string;
  /** The version this run is pinned to, from the router's decision. */
  graphVersion?: number | null;
  langgraphThreadId: string;
  inputRef?: Record<string, unknown>;
}): Promise<string | null> {
  const defId = await resolveAgentDefinitionId(args.pool, args.agentName);
  const inputJson = JSON.stringify({
    graph_key: args.graphKey,
    agent_name: args.agentName,
    langgraph_thread_id: args.langgraphThreadId,
    ...(args.inputRef ?? {}),
  });

  let runId: string | null = null;

  try {
    await ensureOrchAuditTables(args.pool);
    const existing = await args.pool.query<{ id: string }>(
      `SELECT id::text AS id FROM orch.runs
       WHERE trigger_event_id = $1 AND graph_key = $2
       LIMIT 1`,
      [args.triggerEventId, args.graphKey],
    );
    if (existing.rows[0]?.id) {
      runId = existing.rows[0].id;
      /**
       * A re-delivered event restarts the existing run.
       *
       * `completed_at` and `error` are CLEARED here, and that is a fix rather
       * than a detail. Previously this set status back to RUNNING and left
       * both in place, so a finished run came back to life carrying the
       * timestamp of the finish it had already had — a state the rest of the
       * system cannot produce and no screen can explain. Three such rows are
       * sitting in the database now, showing as RUNNING for six days with a
       * completion time attached.
       *
       * A run that is running has not completed. Keeping the old values made
       * that sentence false.
       */
      await args.pool.query(
        `UPDATE orch.runs
         SET status = 'RUNNING',
             started_at = COALESCE(started_at, now()),
             completed_at = NULL,
             error = NULL,
             graph_version = COALESCE($2, graph_version)
         WHERE id = $1`,
        [runId, args.graphVersion ?? null],
      );
      console.log(
        `[orch_runs] resume run=${runId} event=${args.triggerEventId}`,
      );
    } else {
      runId = randomUUID();
      await args.pool.query(
        `INSERT INTO orch.runs (
           id, organization_id, agent_name, trigger_event_id, graph_key,
           graph_version, status, langgraph_thread_id, input_ref, started_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'RUNNING',$7,$8::jsonb, now())`,
        [
          runId,
          args.organizationId,
          args.agentName,
          args.triggerEventId,
          args.graphKey,
          args.graphVersion ?? null,
          args.langgraphThreadId,
          inputJson,
        ],
      );
      console.log(
        `[orch_runs] STARTED run=${runId} agent=${args.agentName} graph=${args.graphKey} event=${args.triggerEventId}`,
      );
    }
  } catch (err) {
    console.warn(
      `[orch_runs] start failed (fail-open):`,
      err instanceof Error ? err.message : err,
    );
  }

  // Best-effort design table (often GRANT-denied on shared Supabase).
  if (defId) {
    try {
      await withOrgConnection(args.pool, args.organizationId, async (client) => {
        const existing = await client.query<{ id: string }>(
          `SELECT id::text AS id FROM agent_runs
           WHERE agent_definition_id = $1 AND trigger_event_id = $2
           LIMIT 1`,
          [defId, args.triggerEventId],
        );
        if (existing.rows[0]?.id) {
          await client.query(
            `UPDATE agent_runs
             SET status = 'RUNNING', started_at = COALESCE(started_at, now()),
                 updated_at = now()
             WHERE id = $1`,
            [existing.rows[0].id],
          );
          return;
        }
        const agentRunId = randomUUID();
        await client.query(
          `INSERT INTO agent_runs (
             id, organization_id, agent_definition_id, trigger_type,
             trigger_event_id, input_ref, status, thread_id, started_at
           ) VALUES (
             $1, $2, $3, 'EVENT', $4, $5::jsonb, 'RUNNING', $6, now()
           )`,
          [
            agentRunId,
            args.organizationId,
            defId,
            args.triggerEventId,
            JSON.stringify({ ...JSON.parse(inputJson), orch_run_id: runId }),
            `${args.organizationId}:${agentRunId}`,
          ],
        );
        console.log(
          `[agent_runs] STARTED run=${agentRunId} agent=${args.agentName}`,
        );
      });
    } catch (err) {
      console.warn(
        `[agent_runs] start failed (fail-open):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return runId;
}

export async function finishAgentRun(args: {
  pool: Pool;
  organizationId: string;
  runId: string;
  status: Extract<
    AgentRunStatus,
    'COMPLETED' | 'FAILED' | 'WAITING_APPROVAL' | 'CANCELLED'
  >;
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

  try {
    await withOrgConnection(args.pool, args.organizationId, async (client) => {
      await client.query(
        `UPDATE agent_runs
         SET status = $2,
             completed_at = CASE WHEN $2 IN ('COMPLETED','FAILED','CANCELLED','EXPIRED')
               THEN now() ELSE completed_at END,
             error = CASE WHEN $3::jsonb IS NULL THEN error ELSE $3::jsonb END,
             updated_at = now()
         WHERE organization_id = $4
           AND (
             id = $1
             OR input_ref->>'orch_run_id' = $1::text
             OR trigger_event_id IN (
               SELECT trigger_event_id FROM orch.runs WHERE id = $1
             )
           )`,
        [args.runId, args.status, errJson, args.organizationId],
      );
    });
  } catch (err) {
    console.warn(
      `[agent_runs] finish failed (fail-open):`,
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
    await args.pool.query(
      `INSERT INTO orch.steps (
         id, run_id, seq, node, tool_name, input, output_ref, latency_ms, status
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)`,
      [
        randomUUID(),
        args.runId,
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
     FROM event_outbox
     WHERE event_id::text = $1
        OR causation_id::text = $1
        OR (
          correlation_id::text = (
            SELECT correlation_id::text FROM event_outbox
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
