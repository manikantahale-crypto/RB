/**
 * Runs waiting on a person: finding one, and taking it back.
 *
 * TWO GAPS THIS CLOSES.
 *
 * A decision reaching the platform from outside knows which conversation it
 * belongs to, not which LangGraph thread. The dispatcher required
 * `thread_id` and `graph_key` on the resume event and acknowledged — dropped
 * — anything without them (dispatch-handlers.ts, "missing thread_id/graph_key
 * — ack"). The run's own record already holds the correlation
 * (`orch.runs.input_ref->>'correlation_id'`, runner.ts:57), so a decision
 * carrying only a correlation can be matched to its parked run here.
 *
 * And a resume was never claimed. The thread was handed straight to
 * LangGraph, so a decision delivered twice resumed twice, and a run that
 * parked again — remind, wait, remind — kept the status of its first park
 * because nothing wrote the second. `claimParkedRun` flips PARKED → RUNNING
 * atomically; a second claim finds nothing and the caller declines, which
 * is what "exactly once" means for a resume.
 */

export type Queryable = {
  query: <R = unknown>(text: string, params?: unknown[]) => Promise<{ rows: R[] }>;
};

export type ParkedRun = {
  id: string;
  graph_key: string;
  graph_version: number | null;
  langgraph_thread_id: string;
  organization_id: string;
};

/**
 * The parked run a decision is about, by the correlation it carries.
 *
 * Newest first, one row: a correlation names one flow, and a flow has at most
 * one run waiting at a gate at a time. `graphKey` narrows it when the caller
 * knows which workflow it means (a consent reply is for the consent
 * workflow), and is ignored when it does not.
 */
export async function resolveParkedRun(
  db: Queryable,
  args: { organizationId: string; correlationId: string; graphKey?: string | null },
): Promise<ParkedRun | null> {
  if (!args.correlationId) return null;
  const { rows } = await db.query<ParkedRun>(
    `SELECT id::text AS id,
            graph_key,
            graph_version,
            langgraph_thread_id,
            organization_id::text AS organization_id
       FROM orch.runs
      WHERE status = 'PARKED'
        AND organization_id = $1::uuid
        AND input_ref->>'correlation_id' = $2
        AND ($3::text IS NULL OR graph_key = $3)
        AND langgraph_thread_id IS NOT NULL
      ORDER BY started_at DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [args.organizationId, args.correlationId, args.graphKey ?? null],
  );
  return rows[0] ?? null;
}

/**
 * Take a parked run back to RUNNING before LangGraph continues it.
 *
 * Returns the run, or null when there is nothing parked on that thread —
 * already resumed, never parked, or finished. The caller must then NOT
 * resume: a second `Command({ resume })` on a thread that is not interrupted
 * is a duplicate decision, not a retry.
 *
 * `completed_at` and `error` are cleared for the same reason
 * `startAgentRun` clears them on a re-delivered event: a run that is running
 * has not completed. The heartbeat starts here so the stale sweeper judges
 * the resume from now, not from the park.
 */
export async function claimParkedRun(
  db: Queryable,
  args: { threadId: string; graphKey?: string | null },
): Promise<ParkedRun | null> {
  const { rows } = await db.query<ParkedRun>(
    `UPDATE orch.runs
        SET status = 'RUNNING',
            heartbeat_at = now(),
            completed_at = NULL,
            error = NULL
      WHERE langgraph_thread_id = $1
        AND status = 'PARKED'
        AND ($2::text IS NULL OR graph_key = $2)
  RETURNING id::text AS id,
            graph_key,
            graph_version,
            langgraph_thread_id,
            organization_id::text AS organization_id`,
    [args.threadId, args.graphKey ?? null],
  );
  return rows[0] ?? null;
}
