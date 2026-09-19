/**
 * Runs whose worker stopped talking.
 *
 * A run is RUNNING between the runner's first write and its last. If the
 * process dies in between — crash, deploy, a laptop closed — nothing ever
 * writes the last one, and the row shows RUNNING for as long as the table
 * exists. The node timeout (node-timeout.ts) cannot help: it lives in the
 * process that died.
 *
 * So the worker beats while it runs (run-heartbeat.ts) and this sweeper,
 * on its own timer, fails any RUNNING run that has been silent longer than
 * ORCH_STALE_RUN_AFTER_MS. Ten minutes by default: twenty beats missed at the
 * default interval, which is a dead worker rather than a slow one.
 *
 * WHAT "FAIL" MEANS HERE. status FAILED, completed_at now, and an error that
 * says STALE_RUN with the last beat, so the runs screen tells the truth —
 * "this run was abandoned at 14:02" — instead of "in progress". The class is
 * transient: nothing is known to be wrong with the input. The worker
 * announces each swept run as `syntra.agent_run.failed` (announce-failure.ts)
 * so the retry workflow can decide, which is why the correlation comes back
 * with the row.
 *
 * WHAT IT DOES NOT TOUCH. A run parked at human.gate is PARKED, not
 * RUNNING, and may wait for days. A run that predates heartbeat_at is judged
 * by started_at, which is what a never-beating run looks like anyway.
 *
 * SAFE WITH MANY WORKERS. FOR UPDATE SKIP LOCKED: two sweepers share the
 * work rather than fight over it, and a runner mid-write on a row skips it.
 */

export type Queryable = {
  query: <R = unknown>(text: string, params?: unknown[]) => Promise<{ rows: R[] }>;
};

export const DEFAULT_STALE_RUN_AFTER_MS = 10 * 60 * 1000;
export const DEFAULT_STALE_SWEEP_EVERY_MS = 60 * 1000;

export type SweptRun = {
  id: string;
  graph_key: string;
  organization_id: string;
  trigger_event_id: string | null;
  langgraph_thread_id: string | null;
  correlation_id: string | null;
  silent_since: string;
};

function positiveInt(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function staleRunSettings(
  env: Record<string, string | undefined> = process.env,
): { staleAfterMs: number; sweepEveryMs: number } {
  return {
    staleAfterMs: positiveInt(env.ORCH_STALE_RUN_AFTER_MS, DEFAULT_STALE_RUN_AFTER_MS),
    sweepEveryMs: positiveInt(env.ORCH_STALE_SWEEP_EVERY_MS, DEFAULT_STALE_SWEEP_EVERY_MS),
  };
}

/** Sweep once. Returns what it failed, so the caller can say so. */
export async function sweepStaleRuns(
  db: Queryable,
  args: { staleAfterMs: number },
): Promise<SweptRun[]> {
  const { rows } = await db.query<SweptRun>(
    `WITH stale AS (
       SELECT id, COALESCE(heartbeat_at, started_at, created_at) AS silent_since
         FROM orch.runs
        WHERE status = 'RUNNING'
          AND COALESCE(heartbeat_at, started_at, created_at)
                < now() - ($1::int * interval '1 millisecond')
        FOR UPDATE SKIP LOCKED
     )
     UPDATE orch.runs r
        SET status = 'FAILED',
            completed_at = now(),
            error = jsonb_build_object(
              'code', 'STALE_RUN',
              'error_class', 'transient',
              'message',
                'no heartbeat since ' || to_char(stale.silent_since AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                || ' — the worker running it stopped; swept',
              'swept_at', now()
            )
       FROM stale
      WHERE r.id = stale.id
  RETURNING r.id::text AS id,
            r.graph_key,
            r.organization_id::text AS organization_id,
            r.trigger_event_id::text AS trigger_event_id,
            r.langgraph_thread_id,
            r.input_ref->>'correlation_id' AS correlation_id,
            stale.silent_since::text AS silent_since`,
    [args.staleAfterMs],
  );
  return rows;
}

/**
 * Sweep on a timer until `stop()`. The first sweep runs immediately: a worker
 * that restarts after a crash is exactly when there is something to find.
 */
export function startStaleRunSweeper(args: {
  db: Queryable;
  staleAfterMs: number;
  sweepEveryMs: number;
  onSwept?: (runs: SweptRun[]) => void;
  onError?: (err: unknown) => void;
}): { stop: () => void } {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const swept = await sweepStaleRuns(args.db, { staleAfterMs: args.staleAfterMs });
      if (swept.length > 0) args.onSwept?.(swept);
    } catch (err) {
      args.onError?.(err);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), args.sweepEveryMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
