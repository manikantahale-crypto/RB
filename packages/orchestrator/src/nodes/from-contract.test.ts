/**
 * The run context — what each step produced, filed under its step id.
 *
 * Step one of the input-mapping work. Nothing READS the context yet; these pin
 * that it is written, and written under the right name, because the two halves
 * land separately on purpose: writing is an addition, resolving is a behaviour
 * change.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toNodeImpl } from './from-contract.js';
import type { NodeCtx, SyntraGraphState } from './types.js';

/** A contract shaped like a real one, without the ceremony. */
const contract = {
  key: 'syntra.jd.process',
  input: z.object({ jobId: z.string() }),
  output: z.object({ jobId: z.string(), status: z.string() }),
  config: z.object({}).passthrough(),
  run: async (_ctx: unknown, input: { jobId: string }) => ({
    jobId: input.jobId,
    status: 'processed',
  }),
} as unknown as Parameters<typeof toNodeImpl>[0];

function ctxFor(nodeId: string): NodeCtx {
  return {
    orgId: 'org-1',
    nodeId,
    config: {},
    logger: { info: () => {}, error: () => {} },
    db: { withOrg: async () => { throw new Error('no db'); } },
    events: { emit: () => {} },
  } as unknown as NodeCtx;
}

const state = (over: Partial<SyntraGraphState> = {}): SyntraGraphState =>
  ({
    result: '',
    _emittedEvents: [],
    trigger_event: {
      event_id: 'e1',
      event_type: 'syntra.jd.received',
      organization_id: 'org-1',
      payload: { jobId: '8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11' },
    },
    profile: null,
    matches: [],
    agent_run_id: null,
    ...over,
  }) as unknown as SyntraGraphState;

describe('a step files its output in the run context', () => {
  it('writes the declared output under the step id', async () => {
    const out = await toNodeImpl(contract)(state(), ctxFor('process'));
    expect(out.steps).toEqual({
      process: {
        jobId: '8f14e45f-ceea-467a-9f4b-4a2c1e9d0a11',
        status: 'processed',
      },
    });
  });

  it('keys on the STEP id, not the node key', async () => {
    // The same implementation runs at several ids across graphs, so a later
    // step refers to the position it wants, not to whatever filled it.
    const out = await toNodeImpl(contract)(state(), ctxFor('parse_jd'));
    expect(Object.keys(out.steps!)).toEqual(['parse_jd']);
    expect(out.steps).not.toHaveProperty('syntra.jd.process');
  });

  it('still returns the result breadcrumb it always did', async () => {
    const out = await toNodeImpl(contract)(state(), ctxFor('process'));
    expect(out.result).toContain('syntra.jd.process');
  });

  it('writes nothing when the step fails its own output schema', async () => {
    // A node returning something its contract does not describe must fail
    // loudly rather than file a shape nothing guarantees.
    const bad = { ...contract, run: async () => ({ jobId: 1 }) } as typeof contract;
    await expect(toNodeImpl(bad)(state(), ctxFor('process'))).rejects.toThrow(
      /NODE_OUTPUT_INVALID/,
    );
  });
});

describe('the context accumulates rather than replaces', () => {
  it('merges by the reducer the graph state declares', () => {
    // The channel's reducer is `(x, y) => ({ ...x, ...y })`. This pins the
    // behaviour the resolver will depend on: an earlier step's entry survives
    // a later step writing its own.
    const merge = (x: Record<string, unknown>, y: Record<string, unknown>) => ({
      ...x,
      ...y,
    });
    const after1 = merge({}, { process: { jobId: 'a' } });
    const after2 = merge(after1, { detect: { duplicate: false } });
    expect(after2).toEqual({
      process: { jobId: 'a' },
      detect: { duplicate: false },
    });
  });
});
