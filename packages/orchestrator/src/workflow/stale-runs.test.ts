/**
 * The sweeper's contract with the database, and with the clock.
 *
 * The SQL is pinned by shape rather than run: only RUNNING rows, judged by
 * heartbeat with started_at as the fallback, locked with SKIP LOCKED, and
 * failed with an error that names the cause. The timer is pinned by
 * behaviour: one sweep at a time, first one immediately, stoppable.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STALE_RUN_AFTER_MS,
  DEFAULT_STALE_SWEEP_EVERY_MS,
  staleRunSettings,
  startStaleRunSweeper,
  sweepStaleRuns,
  type Queryable,
} from './stale-runs.js';

function dbReturning(rows: unknown[]): Queryable & { calls: Array<{ text: string; params?: unknown[] }> } {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  return {
    calls,
    query: async <R,>(text: string, params?: unknown[]) => {
      calls.push({ text, params });
      return { rows: rows as R[] };
    },
  };
}

describe('staleRunSettings', () => {
  it('reads both knobs from the environment, with defaults', () => {
    expect(staleRunSettings({})).toEqual({
      staleAfterMs: DEFAULT_STALE_RUN_AFTER_MS,
      sweepEveryMs: DEFAULT_STALE_SWEEP_EVERY_MS,
    });
    expect(
      staleRunSettings({ ORCH_STALE_RUN_AFTER_MS: '120000', ORCH_STALE_SWEEP_EVERY_MS: '5000' }),
    ).toEqual({ staleAfterMs: 120_000, sweepEveryMs: 5_000 });
    expect(staleRunSettings({ ORCH_STALE_RUN_AFTER_MS: '-1' }).staleAfterMs).toBe(
      DEFAULT_STALE_RUN_AFTER_MS,
    );
  });
});

describe('sweepStaleRuns — the statement', () => {
  it('fails only RUNNING runs, judged by heartbeat then started_at, without waiting on locks', async () => {
    const db = dbReturning([]);
    await sweepStaleRuns(db, { staleAfterMs: 600_000 });

    expect(db.calls).toHaveLength(1);
    const { text, params } = db.calls[0]!;
    expect(params).toEqual([600_000]);
    expect(text).toMatch(/WHERE status = 'RUNNING'/);
    expect(text).toMatch(/COALESCE\(heartbeat_at, started_at, created_at\)/);
    expect(text).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(text).toMatch(/SET status = 'FAILED'/);
    expect(text).toMatch(/'code', 'STALE_RUN'/);
    expect(text).toMatch(/'error_class', 'transient'/);
    expect(text).toMatch(/input_ref->>'correlation_id' AS correlation_id/);
    // Parked runs are never RUNNING and must never be touched.
    expect(text).not.toMatch(/WAITING_APPROVAL|PARKED/);
  });

  it('returns what it swept', async () => {
    const swept = [
      {
        id: 'run-1',
        graph_key: 'syntra.jd.workflow',
        organization_id: 'org-1',
        trigger_event_id: 'evt-1',
        langgraph_thread_id: 'org-1:evt-1',
        correlation_id: 'corr-1',
        silent_since: '2026-09-19 10:00:00+00',
      },
    ];
    const db = dbReturning(swept);
    expect(await sweepStaleRuns(db, { staleAfterMs: 1 })).toEqual(swept);
  });
});

describe('startStaleRunSweeper — the timer', () => {
  it('sweeps immediately, then on the interval, and stops when told', async () => {
    vi.useFakeTimers();
    try {
      const db = dbReturning([]);
      const sweeper = startStaleRunSweeper({ db, staleAfterMs: 1, sweepEveryMs: 1_000 });
      await vi.advanceTimersByTimeAsync(0);
      expect(db.calls).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(2_000);
      expect(db.calls).toHaveLength(3);

      sweeper.stop();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(db.calls).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports what it swept and survives a failed sweep', async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const seen: unknown[] = [];
      const errors: unknown[] = [];
      const db: Queryable = {
        query: async <R,>() => {
          n += 1;
          if (n === 1) throw new Error('connection reset');
          return { rows: [{ id: `run-${n}` }] as R[] };
        },
      };
      const sweeper = startStaleRunSweeper({
        db,
        staleAfterMs: 1,
        sweepEveryMs: 100,
        onSwept: (runs) => seen.push(...runs),
        onError: (err) => errors.push(err),
      });
      await vi.advanceTimersByTimeAsync(250);
      sweeper.stop();

      expect(errors).toHaveLength(1);
      expect(seen).toEqual([{ id: 'run-2' }, { id: 'run-3' }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
