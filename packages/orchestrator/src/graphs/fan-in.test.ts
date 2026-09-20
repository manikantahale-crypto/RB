/**
 * Fan-out, fan-in, and a bad setting refused at compile time.
 *
 * Driven through the real compiler with a registry of test nodes and a pool
 * that answers nothing (no audit row, no policy): what is pinned is the
 * wiring — every branch runs, the join runs ONCE after the last of them, a
 * failed branch blocks the join and the run ends there, and a config the
 * contract refuses never compiles.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GraphCompiler } from './compiler.js';
import type { GraphDefinition } from './recipe.js';
import type { NodeFactory, NodeImpl, SyntraGraphState } from '../nodes/types.js';
import { PolicyEngine } from '../policy/engine.js';

const pool = {
  query: async () => ({ rows: [], rowCount: 0 }),
  connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release: () => {} }),
} as never;

/** A policy engine that always says go, without a database. */
const policy = { evaluate: async () => null } as unknown as PolicyEngine;

const trigger = {
  event_id: 'evt-1',
  event_type: 'syntra.jd.received',
  aggregate_id: 'req-1',
  aggregate_type: 'requirement',
  organization_id: '00000000-0000-0000-0000-000000000001',
  correlation_id: 'corr-1',
  payload: { jobId: 'req-1' },
};

function registry(order: string[], opts: { failIn?: string } = {}): Record<string, NodeFactory> {
  const step = (name: string): NodeImpl => async (_state, ctx) => {
    order.push(ctx.nodeId);
    if (opts.failIn === ctx.nodeId) {
      throw new Error(`unprocessable JD: ${ctx.nodeId} cannot read it`); // permanent-input → soft
    }
    await new Promise((r) => setTimeout(r, name === 'slow' ? 30 : 1));
    return { result: `${ctx.nodeId} ok`, steps: { [ctx.nodeId]: { done: true } } };
  };
  return {
    'test.parse': () => step('parse'),
    'test.fast': () => step('fast'),
    'test.slow': () => step('slow'),
    'test.join': () => step('join'),
    'test.after': () => step('after'),
  };
}

const fan = (over: Partial<GraphDefinition> = {}): GraphDefinition => ({
  graphKey: 'test.fan',
  nodes: [
    { id: 'parse', impl: 'test.parse' },
    { id: 'a', impl: 'test.fast' },
    { id: 'b', impl: 'test.slow' },
    { id: 'c', impl: 'test.fast' },
    { id: 'join', impl: 'test.join', joinOn: ['a', 'b', 'c'] },
    { id: 'after', impl: 'test.after' },
  ],
  edges: [
    ['__start__', 'parse'],
    ['parse', 'a'],
    ['parse', 'b'],
    ['parse', 'c'],
    ['a', 'join'],
    ['b', 'join'],
    ['c', 'join'],
    ['join', 'after'],
    ['after', '__end__'],
  ],
  ...over,
});

const initial = (): Partial<SyntraGraphState> => ({ trigger_event: trigger, agent_run_id: null });

describe('fan-out and fan-in', () => {
  it('runs every branch, then the join once after the slowest, then what follows', async () => {
    const order: string[] = [];
    const graph = new GraphCompiler(pool, undefined, policy, registry(order)).compileDefinition(fan());
    const final = (await graph.invoke(initial())) as SyntraGraphState;

    expect(order[0]).toBe('parse');
    expect(order.slice(1, 4).sort()).toEqual(['a', 'b', 'c']);
    expect(order.filter((n) => n === 'join')).toHaveLength(1);
    expect(order.indexOf('join')).toBeGreaterThan(order.indexOf('b')); // b is the slow one
    expect(order[order.length - 1]).toBe('after');
    expect(final.steps).toMatchObject({ a: { done: true }, b: { done: true }, c: { done: true }, join: { done: true } });
  });

  it('a join is implied by several edges in, without joinOn', async () => {
    const order: string[] = [];
    const def = fan({ nodes: fan().nodes.map((n) => (n.id === 'join' ? { id: 'join', impl: 'test.join' } : n)) });
    const graph = new GraphCompiler(pool, undefined, policy, registry(order)).compileDefinition(def);
    await graph.invoke(initial());
    expect(order.filter((n) => n === 'join')).toHaveLength(1);
    expect(order[order.length - 1]).toBe('after');
  });

  it('a branch that failed blocks the join, and the run ends there', async () => {
    const order: string[] = [];
    const graph = new GraphCompiler(pool, undefined, policy, registry(order, { failIn: 'b' })).compileDefinition(fan());
    const final = (await graph.invoke(initial())) as SyntraGraphState;

    expect(order).not.toContain('after');
    // the join was reached (all branches settled) but declined to run
    expect(final.errorsSoft?.map((e) => e.nodeId).sort()).toEqual(['b', 'join']);
    expect(final.errorsSoft?.find((e) => e.nodeId === 'join')?.message).toMatch(/join blocked: b:/);
    expect(final.steps).not.toHaveProperty('join');
  });
});

describe('a setting the contract refuses', () => {
  it('fails at compile time, naming the step and the field', () => {
    const order: string[] = [];
    const reg = registry(order);
    const strict: NodeImpl = Object.assign(reg['test.parse']!(), {
      configSchema: z.object({ threshold: z.number().min(0).max(100) }),
    });
    reg['test.parse'] = () => strict;
    const def = fan({
      nodes: fan().nodes.map((n) => (n.id === 'parse' ? { ...n, config: { threshold: 250 } } : n)),
    });
    expect(() => new GraphCompiler(pool, undefined, policy, reg).compileDefinition(def)).toThrow(
      /DEFINITION_INVALID: step "parse" \(test\.parse\) has a config its contract refuses — threshold:/,
    );
  });
});
