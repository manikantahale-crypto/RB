/**
 * Routing precedence: the binding decides, the hardcoded plan fills the silence.
 *
 * The fixtures are the live faults this inversion was written for.
 * `syntra.match.completed` is `terminal` in the hardcoded map AND carries an
 * active binding to `syntra.shortlist.workflow` — under the old order it was
 * acknowledged and dropped before the binding was read.
 */
import { describe, expect, it } from 'vitest';
import { decideRelayTargets, decideRoute } from './decide-route.js';

const binding = {
  graph_key: 'syntra.shortlist.workflow',
  module_queue: 'module.syntra.match',
};

const run = (over: Record<string, unknown> = {}) =>
  decideRoute({
    eventType: 'syntra.match.completed',
    organizationId: null,
    binding,
    plan: { kind: 'terminal', note: 'Outcome of match — UI / audit only' },
    ...over,
  } as Parameters<typeof decideRoute>[0]);

describe('decideRoute', () => {
  it('runs the bound workflow even when the hardcoded map says terminal', () => {
    // THE regression. Seven live bindings were dropped exactly here, because
    // the map was consulted before the database.
    expect(run()).toEqual({
      kind: 'run',
      graphKey: 'syntra.shortlist.workflow',
      moduleQueue: 'module.syntra.match',
    });
  });

  it('runs it when the map says fail, too', () => {
    // syntra.agent_run.failed -> syntra.run.retry.workflow. A retry workflow
    // that never ran, because the map classified the event as ops-only.
    const out = run({
      eventType: 'syntra.agent_run.failed',
      binding: {
        graph_key: 'syntra.run.retry.workflow',
        module_queue: 'module.syntra.jd',
      },
      plan: { kind: 'fail', note: 'Ops — persist to failed_workflows' },
    });
    expect(out.kind).toBe('run');
  });

  it('runs an event the hardcoded map has never heard of', () => {
    // The whole point: a module can register an event and bind a workflow to
    // it without an engine release. Nineteen catalogue events are unknown to
    // the map today.
    const out = run({
      eventType: 'brandnew.module.thing.happened',
      plan: { kind: 'terminal', note: 'Unknown event — ack as terminal' },
    });
    expect(out.kind).toBe('run');
  });

  it('acks with the plan note when there is no binding', () => {
    // The plan still earns its place here: it says WHY nothing runs.
    const out = run({
      binding: null,
      plan: { kind: 'resume', note: 'Approval decided — resume parked thread' },
    });
    expect(out).toEqual({
      kind: 'ack',
      label: 'RESUME',
      note: 'syntra.match.completed — Approval decided — resume parked thread (ack, no graph)',
    });
  });

  it('says unroutable when the plan expected a graph and none is bound', () => {
    // Different from the case above, and worth different words: this one is a
    // misconfiguration, not a deliberate hand-off elsewhere.
    const out = run({
      binding: null,
      plan: { kind: 'graph', note: 'Trigger — routed via graph_event_bindings' },
    });
    expect(out.kind).toBe('ack');
    expect((out as { label: string }).label).toBe('UNROUTABLE');
    expect((out as { note: string }).note).toContain('no active binding');
  });

  it('names the organisation scope when unroutable', () => {
    const out = run({
      binding: null,
      organizationId: 'org-1',
      plan: { kind: 'graph', note: 'Trigger' },
    });
    expect((out as { note: string }).note).toContain('org=org-1');
  });

  it('never runs anything without a binding, whatever the plan says', () => {
    // The invariant that survives the inversion: no binding, no run. The
    // hardcoded map must not be able to START something either.
    for (const kind of ['graph', 'terminal', 'resume', 'fail'] as const) {
      const out = run({ binding: null, plan: { kind, note: 'x' } });
      expect(out.kind).toBe('ack');
    }
  });
});

describe('decideRelayTargets', () => {
  const t = (kind: 'graph' | 'terminal' | 'resume' | 'fail', bound: boolean) =>
    decideRelayTargets({ plan: { kind, note: 'x' }, bound });

  it('sends a graph event to the router, as it always did', () => {
    expect(t('graph', false)).toEqual({ ingress: true, dispatch: false });
    expect(t('graph', true)).toEqual({ ingress: true, dispatch: false });
  });

  it('sends an unbound non-graph event to dispatch only, as it always did', () => {
    // Nothing that worked before stops working. This is the whole reason the
    // change is additive rather than a swap.
    expect(t('terminal', false)).toEqual({ ingress: false, dispatch: true });
    expect(t('resume', false)).toEqual({ ingress: false, dispatch: true });
    expect(t('fail', false)).toEqual({ ingress: false, dispatch: true });
  });

  it('sends a bound event to the router AS WELL, whatever the map says', () => {
    // The six bindings that never ran. They were not being dropped by the
    // router — they never reached it.
    expect(t('terminal', true).ingress).toBe(true);
    expect(t('fail', true).ingress).toBe(true);
    expect(t('resume', true).ingress).toBe(true);
  });

  it('never takes dispatch away from resume or fail', () => {
    // `resume` unparks a waiting human gate; `fail` records the run for
    // replay. Routing a workflow as well must not cost either of those.
    expect(t('resume', true).dispatch).toBe(true);
    expect(t('fail', true).dispatch).toBe(true);
  });

  it('does both for a bound fail — record it and retry it', () => {
    // syntra.agent_run.failed -> syntra.run.retry.workflow. The failure is
    // still written to failed_workflows, and the retry workflow now runs.
    expect(t('fail', true)).toEqual({ ingress: true, dispatch: true });
  });
});
