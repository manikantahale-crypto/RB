import type { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';

export type FailedWorkflowRow = {
  organization_id: string;
  event_id: string;
  thread_id: string;
  graph_key: string;
  graph_version: number | null;
  queue: string;
  error_class: string;
  error_message: string;
  pinned_payload: Record<string, unknown>;
};

/** Design §10 — mirror exhausted / permanent-system failures for ops replay. */
export async function ensureFailedWorkflowsTable(
  client: Pool | PoolClient,
): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS failed_workflows (
      id               text PRIMARY KEY,
      organization_id  text NOT NULL,
      event_id         text NOT NULL,
      thread_id        text NOT NULL,
      graph_key        text NOT NULL,
      graph_version    int,
      queue            text NOT NULL,
      error_class      text NOT NULL,
      error_message    text NOT NULL,
      pinned_payload   jsonb NOT NULL,
      created_at       timestamptz NOT NULL DEFAULT now(),
      replayed_at      timestamptz
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS failed_workflows_org_created_idx
      ON failed_workflows (organization_id, created_at DESC)
  `);
}

export async function recordFailedWorkflow(
  pool: Pool,
  row: FailedWorkflowRow,
): Promise<string> {
  const id = uuidv4();
  await ensureFailedWorkflowsTable(pool);
  await pool.query(
    `INSERT INTO failed_workflows (
       id, organization_id, event_id, thread_id, graph_key, graph_version,
       queue, error_class, error_message, pinned_payload
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [
      id,
      row.organization_id,
      row.event_id,
      row.thread_id,
      row.graph_key,
      row.graph_version,
      row.queue,
      row.error_class,
      row.error_message,
      JSON.stringify(row.pinned_payload),
    ],
  );
  return id;
}

/**
 * Replay = re-enqueue the pinned payload on the module queue.
 * Checkpoint resume (D4) continues from last completed node when thread_id matches.
 */
export async function loadFailedWorkflowForReplay(
  pool: Pool,
  failedId: string,
): Promise<FailedWorkflowRow | null> {
  const { rows } = await pool.query(
    `SELECT organization_id, event_id, thread_id, graph_key, graph_version,
            queue, error_class, error_message, pinned_payload
     FROM failed_workflows WHERE id = $1`,
    [failedId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    organization_id: r.organization_id,
    event_id: r.event_id,
    thread_id: r.thread_id,
    graph_key: r.graph_key,
    graph_version: r.graph_version,
    queue: r.queue,
    error_class: r.error_class,
    error_message: r.error_message,
    pinned_payload: r.pinned_payload,
  };
}

export async function markFailedWorkflowReplayed(
  pool: Pool,
  failedId: string,
): Promise<void> {
  await pool.query(
    `UPDATE failed_workflows SET replayed_at = now() WHERE id = $1`,
    [failedId],
  );
}
