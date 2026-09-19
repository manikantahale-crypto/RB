/**
 * When a run has failed for good, say so — as an event.
 *
 * `syntra.agent_run.failed` has been in the catalogue, bound to
 * `syntra.run.retry.workflow`, live, for weeks, and nothing in this
 * repository ever published it (2026-09-19: the only references are the
 * dispatcher that consumes it and the SYNTRA endpoint that acts on it). The
 * retry workflow has never run because its trigger has never fired.
 *
 * This publishes it from the module worker at the two points a run is
 * finally lost: a permanent-system failure, and a transient one that has
 * used up pg-boss's attempts. Not on every attempt — the retry workflow is
 * for work the queue has given up on.
 *
 * THE LOOP, AND WHAT BOUNDS IT. The retry node re-emits the run's trigger
 * event under a new id, which starts a new run; if that fails too, this
 * announces again. The node refuses when `attempts` exceeds its
 * `maxRetryDepth` (1 by default), so `attempts` here has to mean "how many
 * runs of this workflow in this flow have already failed, including this
 * one" — counted from orch.runs by correlation, which is what a retried run
 * shares with the run it retries.
 *
 * The event id is derived (deterministic-id.ts) from the run and the
 * attempt, so a redelivered final attempt announces once.
 */
import type { Pool } from 'pg';
import { EVENT_TYPES } from '@tekisho/domain';
import { withOrgConnection } from '../db/with-org-connection.js';
import { deterministicEventId } from './deterministic-id.js';
import type { ErrorClass } from './errors.js';

export type FailureAnnouncement = {
  runId: string;
  organizationId: string;
  graphKey: string;
  correlationId: string;
  /** The event that started the run — the announcement is caused by it. */
  triggerEventId: string;
  errorClass: ErrorClass;
  errorMessage: string;
  failedNode?: string | null;
};

const ERROR_CODE: Record<ErrorClass, string> = {
  transient: 'TRANSIENT_EXHAUSTED',
  'permanent-input': 'PERMANENT_INPUT',
  'permanent-system': 'PERMANENT_SYSTEM',
};

export async function announceRunFailed(
  pool: Pool,
  a: FailureAnnouncement,
): Promise<{ eventId: string; attempts: number; inserted: boolean } | null> {
  const { rows: runs } = await pool.query<{ agent_name: string; failed_before: string }>(
    `SELECT r.agent_name,
            (SELECT count(*) FROM orch.runs f
              WHERE f.organization_id = r.organization_id
                AND f.graph_key = r.graph_key
                AND f.input_ref->>'correlation_id' = $2
                AND f.status = 'FAILED'
                AND f.id <> r.id) AS failed_before
       FROM orch.runs r
      WHERE r.id = $1::uuid`,
    [a.runId, a.correlationId],
  );
  const run = runs[0];
  if (!run) return null; // no audit row — nothing to announce about

  const attempts = Number(run.failed_before) + 1;
  const eventId = deterministicEventId({
    runKey: `run-failed:${a.runId}`,
    nodeId: '_runner',
    eventType: EVENT_TYPES.AGENT_RUN_FAILED,
    index: attempts,
  });

  // The catalogue's payload schema is closed (additionalProperties: false):
  // exactly these keys, and error_message carries no candidate data — an
  // error string, cut short.
  const payload = {
    agent_run_id: a.runId,
    agent_name: run.agent_name,
    error_code: ERROR_CODE[a.errorClass],
    error_message: a.errorMessage.slice(0, 300),
    failed_node: a.failedNode ?? null,
    attempts,
  };

  const inserted = await withOrgConnection(pool, a.organizationId, async (client) => {
    const r = await client.query(
      `INSERT INTO orch.event_outbox (
         event_id, event_type, schema_version, organization_id,
         aggregate_type, aggregate_id, correlation_id, causation_id,
         producer, payload_ref
       ) VALUES ($1, $2, '1.0', $3, 'agent_run', $4, $5, $6, 'orchestrator', $7::jsonb)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        eventId,
        EVENT_TYPES.AGENT_RUN_FAILED,
        a.organizationId,
        a.runId,
        a.correlationId,
        a.triggerEventId,
        JSON.stringify(payload),
      ],
    );
    return (r.rowCount ?? 0) > 0;
  });

  return { eventId, attempts, inserted };
}
