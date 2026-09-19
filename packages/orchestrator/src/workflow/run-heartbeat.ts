/**
 * A running run says it is still running.
 *
 * `orch.runs.heartbeat_at` (V20260909.71) is written when a node starts and
 * on a timer while it runs. The stale-run sweeper reads it; nothing else
 * does. A run whose worker died stops beating, and that silence is what the
 * sweeper acts on — see stale-runs.ts.
 *
 * FIRE AND FORGET, ON PURPOSE. The worker's pool is one connection wide, and
 * a node holds that connection for the length of its own transaction. A beat
 * that waited for it would stall the thing it reports on, and a beat that
 * failed would fail a run that is, by definition, fine. So a beat is queued,
 * never awaited by the node, and never rethrown. At most one is in flight:
 * a slow connection collects one late beat, not thirty.
 */

export type Beatable = {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
};

export const DEFAULT_HEARTBEAT_MS = 30_000;

export function heartbeatIntervalMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const n = Number(env.ORCH_RUN_HEARTBEAT_MS);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_HEARTBEAT_MS;
}

export async function touchRun(db: Beatable, runId: string): Promise<void> {
  await db.query(
    `UPDATE orch.runs SET heartbeat_at = now() WHERE id = $1 AND status = 'RUNNING'`,
    [runId],
  );
}

/**
 * Beat once now, then every `intervalMs` until `stop()` is called.
 *
 * Returns a no-op when there is no run id — a node under test, or a run whose
 * audit row could not be written — so the compiler never has to branch.
 */
export function keepAlive(args: {
  db: Beatable;
  runId: string | null | undefined;
  intervalMs: number;
  onError?: (err: unknown) => void;
}): { stop: () => void } {
  const { db, runId, intervalMs } = args;
  if (!runId) return { stop: () => {} };

  let inFlight = false;
  const beat = () => {
    if (inFlight) return;
    inFlight = true;
    touchRun(db, runId)
      .catch((err) => args.onError?.(err))
      .finally(() => {
        inFlight = false;
      });
  };

  beat();
  const timer = setInterval(beat, intervalMs);
  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
  };
}
