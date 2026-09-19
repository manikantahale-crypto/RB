/**
 * One run per event per workflow, and a lost run announced once.
 *
 * Pinned by shape: the claim is one INSERT ... ON CONFLICT ... WHERE that
 * only takes over an attempt that failed or is running; the announcement is
 * the catalogue's closed payload with `attempts` counted from the flow; the
 * unroutable record is written at most once per event.
 */
import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { claimRun } from './agent-runs.js';
import { announceRunFailed } from './announce-failure.js';
import { recordUnroutableOnce } from './failed-workflows.js';

type Call = { text: string; params?: unknown[] };

/** A pool that answers each query from a script, in order, and remembers. */
function pool(answers: Array<unknown[] | ((text: string) => unknown[])>) {
  const calls: Call[] = [];
  const p = {
    calls,
    query: async (text: string, params?: unknown[]) => {
      calls.push({ text, params });
      const next = answers.shift();
      const rows = typeof next === 'function' ? next(text) : (next ?? []);
      return { rows, rowCount: rows.length };
    },
    connect: async () => ({
      query: p.query,
      release: () => {},
    }),
  };
  return p as unknown as Pool & { calls: Call[] };
}

const claimArgs = (p: Pool) => ({
  pool: p,
  organizationId: '00000000-0000-0000-0000-000000000001',
  agentName: 'intake-agent',
  triggerEventId: 'evt-1',
  graphKey: 'syntra.jd.workflow',
  graphVersion: 3,
  langgraphThreadId: 'org:evt-1',
  inputRef: { event_type: 'syntra.jd.received', correlation_id: 'corr-1' },
});

/**
 * Answers by what is asked, not by position: `ensureOrchAuditTables` runs
 * its check once per process and caches it, so a positional script would
 * drift between tests.
 */
function claimPool(insertRows: unknown[], settledRows: unknown[] = []) {
  return pool([
    (text) => {
      if (/INSERT INTO orch\.runs/.test(text)) return insertRows;
      if (/SELECT id::text AS id, status FROM orch\.runs/.test(text)) return settledRows;
      if (/missing/.test(text)) return [{ missing: null }];
      return []; // agent definition lookup, and anything else
    },
    // the same responder for every query
    ...Array.from({ length: 8 }, () => (text: string) => {
      if (/INSERT INTO orch\.runs/.test(text)) return insertRows;
      if (/SELECT id::text AS id, status FROM orch\.runs/.test(text)) return settledRows;
      if (/missing/.test(text)) return [{ missing: null }];
      return [];
    }),
  ]);
}

describe('claimRun — one statement, one answer', () => {
  it('a new event starts a run', async () => {
    const p = claimPool([{ id: 'run-1', inserted: true }]);
    expect(await claimRun(claimArgs(p))).toEqual({ kind: 'started', runId: 'run-1' });
    const insert = p.calls.find((c) => /INSERT INTO orch\.runs/.test(c.text))!;
    expect(insert.text).toMatch(/ON CONFLICT \(trigger_event_id, graph_key\)/);
    expect(insert.text).toMatch(/WHERE orch\.runs\.status IN \('QUEUED', 'RUNNING', 'FAILED'\)/);
    expect(insert.text).toMatch(/completed_at = NULL/);
    expect(insert.text).toMatch(/agent_definition_id/);
  });

  it('a retried attempt takes the existing run over', async () => {
    const p = claimPool([{ id: 'run-1', inserted: false }]);
    expect(await claimRun(claimArgs(p))).toEqual({ kind: 'restarted', runId: 'run-1' });
  });

  it('a duplicate delivery of a finished run is declined, with the status', async () => {
    const p = claimPool([], [{ id: 'run-1', status: 'COMPLETED' }]);
    expect(await claimRun(claimArgs(p))).toEqual({
      kind: 'settled',
      runId: 'run-1',
      status: 'COMPLETED',
    });
  });

  it('runs anyway when the audit write is unavailable (fail-open, as before)', async () => {
    const p = {
      query: async () => {
        throw new Error('permission denied for table runs');
      },
    } as unknown as Pool;
    expect(await claimRun(claimArgs(p))).toEqual({ kind: 'unrecorded' });
  });
});

describe('announceRunFailed — syntra.agent_run.failed, finally published', () => {
  const args = {
    runId: '11111111-1111-4111-8111-111111111111',
    organizationId: '00000000-0000-0000-0000-000000000001',
    graphKey: 'syntra.jd.workflow',
    correlationId: 'corr-1',
    triggerEventId: 'evt-1',
    errorClass: 'transient' as const,
    errorMessage: 'x'.repeat(500),
    failedNode: 'process',
  };

  it('counts attempts from the flow and writes the closed payload', async () => {
    const p = pool([
      [{ agent_name: 'intake-agent', failed_before: '1' }],
      [{ ok: 1 }], // SET LOCAL app.org_id (withOrgConnection)
      [{ ok: 1 }], // BEGIN or similar — script is lenient on the wrapper
      [{ ok: 1 }],
      [{ ok: 1 }],
    ]);
    const said = await announceRunFailed(p, args);
    expect(said?.attempts).toBe(2);
    const insert = p.calls.find((c) => /INSERT INTO orch\.event_outbox/.test(c.text))!;
    expect(insert.text).toMatch(/ON CONFLICT \(event_id\) DO NOTHING/);
    expect(insert.params?.[1]).toBe('syntra.agent_run.failed');
    const payload = JSON.parse(String(insert.params?.[6]));
    expect(Object.keys(payload).sort()).toEqual(
      ['agent_name', 'agent_run_id', 'attempts', 'error_code', 'error_message', 'failed_node'].sort(),
    );
    expect(payload).toMatchObject({
      agent_run_id: args.runId,
      agent_name: 'intake-agent',
      error_code: 'TRANSIENT_EXHAUSTED',
      failed_node: 'process',
      attempts: 2,
    });
    expect(payload.error_message).toHaveLength(300);
  });

  it('announces the same failure under the same id every time', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 2; i++) {
      const p = pool([[{ agent_name: 'a', failed_before: '0' }], [], [], [], []]);
      const said = await announceRunFailed(p, args);
      ids.add(said!.eventId);
    }
    expect(ids.size).toBe(1);
  });

  it('says nothing about a run it has no record of', async () => {
    expect(await announceRunFailed(pool([[]]), args)).toBeNull();
  });
});

describe('recordUnroutableOnce', () => {
  const envelope = {
    event_id: 'evt-9',
    event_type: 'syntra.jd.received',
    organization_id: '00000000-0000-0000-0000-000000000001',
  };

  it('writes the old project\'s shape — unroutable, on the ingress queue — guarded by NOT EXISTS', async () => {
    const p = pool([[{ present: true }], [{ id: 'x' }]]);
    const id = await recordUnroutableOnce(p, envelope);
    expect(id).not.toBeNull();
    const insert = p.calls[1]!;
    expect(insert.text).toMatch(/INSERT INTO orch\.run_failures/);
    expect(insert.text).toMatch(/'orchestration\.ingress', 'unroutable'/);
    expect(insert.text).toMatch(/WHERE NOT EXISTS/);
    expect(insert.text).toMatch(/replayed_at IS NULL/);
  });

  it('answers null when the event was already recorded', async () => {
    const p = pool([[{ present: true }], []]);
    expect(await recordUnroutableOnce(p, envelope)).toBeNull();
  });
});
