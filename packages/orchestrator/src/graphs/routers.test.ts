/**
 * The engine and the editor must agree about which routers exist.
 *
 * They kept separate hand-written lists of the same four things, in packages
 * owned by different people. A router in the editor but not here offers an
 * author a branch that fails at compile with
 * `DEFINITION_INVALID: unknown conditional router`; one here but not there
 * simply cannot be reached.
 *
 * The names and outcomes now live in `@tekisho/graph-contract`. This is the
 * assertion only this package can make: that every name has a function behind
 * it.
 */
import { describe, expect, it } from 'vitest';
import { ROUTER_DEFINITIONS } from '@tekisho/graph-contract';
import { ROUTER_REGISTRY } from './routers.js';

describe('ROUTER_REGISTRY', () => {
  it('has a function for every router the contract names', () => {
    for (const r of ROUTER_DEFINITIONS) {
      expect(typeof ROUTER_REGISTRY[r.key]).toBe('function');
    }
  });

  it('has no function the contract does not name', () => {
    // A router the editor cannot offer is dead code that still has to be read
    // by whoever comes next.
    const named = new Set(ROUTER_DEFINITIONS.map((r) => r.key));
    for (const key of Object.keys(ROUTER_REGISTRY)) {
      expect(named.has(key)).toBe(true);
    }
  });

  it('only ever returns an outcome the contract declares', () => {
    // An arm the function never returns can never run; an outcome the contract
    // does not list has nowhere to go. Both are silent — the run simply takes
    // a path nobody drew.
    const state = (over: Record<string, unknown>) => over as never;

    expect(ROUTER_DEFINITIONS.find((r) => r.key === 'branch_key')!.outcomes)
      .toContain(ROUTER_REGISTRY['branch_key']!(state({ branch_key: 'pass' })));

    expect(
      ROUTER_DEFINITIONS.find((r) => r.key === 'result.approved_or_end')!
        .outcomes,
    ).toContain(
      ROUTER_REGISTRY['result.approved_or_end']!(state({ result: 'approved' })),
    );

    expect(
      ROUTER_DEFINITIONS.find((r) => r.key === 'result.continue_or_gate')!
        .outcomes,
    ).toContain(
      ROUTER_REGISTRY['result.continue_or_gate']!(state({ result: '' })),
    );
  });

  it('falls back to a declared outcome when the state says nothing', () => {
    // Every router is given a state it was not designed for. None may invent
    // an arm — a run that routes to a name nobody drew just stops.
    for (const r of ROUTER_DEFINITIONS) {
      const out = ROUTER_REGISTRY[r.key]!({} as never);
      expect(r.outcomes).toContain(out);
    }
  });
});
