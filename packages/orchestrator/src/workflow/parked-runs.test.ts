/**
 * One word for a waiting run, and what a resume must do before it resumes.
 *
 * The SQL is pinned by shape: a claim is an UPDATE that only touches PARKED
 * and answers with the row or nothing; a lookup by correlation reads the
 * run's own record and never a status the code no longer writes.
 */
import { describe, expect, it } from 'vitest';
import { claimParkedRun, resolveParkedRun, type Queryable } from './parked-runs.js';
import {
  LEGACY_PARKED,
  PARKED,
  RUN_STATUSES,
  isParked,
  isRunStatus,
  normalizeRunStatus,
} from './run-status.js';

function db(rows: unknown[]): Queryable & { calls: Array<{ text: string; params?: unknown[] }> } {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  return {
    calls,
    query: async <R,>(text: string, params?: unknown[]) => {
      calls.push({ text, params });
      return { rows: rows as R[] };
    },
  };
}

describe('run-status — the one word', () => {
  it('names the seven statuses the CHECK in V20260909.72 allows, and not the old one', () => {
    expect([...RUN_STATUSES]).toEqual([
      'QUEUED', 'RUNNING', 'PARKED', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED',
    ]);
    expect(isRunStatus(LEGACY_PARKED)).toBe(false);
    expect(isRunStatus(PARKED)).toBe(true);
  });

  it('still reads the old word, and normalises it', () => {
    expect(isParked('PARKED')).toBe(true);
    expect(isParked('WAITING_APPROVAL')).toBe(true);
    expect(isParked('RUNNING')).toBe(false);
    expect(isParked(null)).toBe(false);
    expect(normalizeRunStatus('WAITING_APPROVAL')).toBe('PARKED');
    expect(normalizeRunStatus('FAILED')).toBe('FAILED');
    expect(normalizeRunStatus(undefined)).toBeNull();
  });
});

describe('claimParkedRun — PARKED → RUNNING, atomically or not at all', () => {
  it('updates only a PARKED row on that thread and clears what a finish left', async () => {
    const d = db([{ id: 'run-1', graph_key: 'g', graph_version: 3, langgraph_thread_id: 'org:evt', organization_id: 'org' }]);
    const run = await claimParkedRun(d, { threadId: 'org:evt', graphKey: 'g' });
    expect(run?.id).toBe('run-1');
    const { text, params } = d.calls[0]!;
    expect(params).toEqual(['org:evt', 'g']);
    expect(text).toMatch(/UPDATE orch\.runs/);
    expect(text).toMatch(/SET status = 'RUNNING'/);
    expect(text).toMatch(/heartbeat_at = now\(\)/);
    expect(text).toMatch(/completed_at = NULL/);
    expect(text).toMatch(/AND status = 'PARKED'/);
    expect(text).toMatch(/RETURNING/);
    expect(text).not.toMatch(/WAITING_APPROVAL/);
  });

  it('answers null when nothing is parked there — the caller must not resume', async () => {
    expect(await claimParkedRun(db([]), { threadId: 'org:evt' })).toBeNull();
  });

  it('does not insist on a graph key when the caller has none', async () => {
    const d = db([]);
    await claimParkedRun(d, { threadId: 'org:evt' });
    expect(d.calls[0]!.params).toEqual(['org:evt', null]);
  });
});

describe('resolveParkedRun — by the correlation a decision carries', () => {
  it('reads the parked run whose record holds that correlation, newest first', async () => {
    const d = db([{ id: 'run-2', graph_key: 'relay.consent.workflow', graph_version: 3, langgraph_thread_id: 'org:e2', organization_id: 'org' }]);
    const run = await resolveParkedRun(d, { organizationId: 'org', correlationId: 'corr-1', graphKey: 'relay.consent.workflow' });
    expect(run?.langgraph_thread_id).toBe('org:e2');
    const { text, params } = d.calls[0]!;
    expect(params).toEqual(['org', 'corr-1', 'relay.consent.workflow']);
    expect(text).toMatch(/WHERE status = 'PARKED'/);
    expect(text).toMatch(/input_ref->>'correlation_id' = \$2/);
    expect(text).toMatch(/ORDER BY started_at DESC/);
    expect(text).toMatch(/LIMIT 1/);
  });

  it('asks nothing without a correlation', async () => {
    const d = db([{ id: 'x' }]);
    expect(await resolveParkedRun(d, { organizationId: 'org', correlationId: '' })).toBeNull();
    expect(d.calls).toHaveLength(0);
  });
});
