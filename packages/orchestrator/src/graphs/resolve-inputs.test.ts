/**
 * Resolving a step's input map against the run context.
 *
 * The behaviour that matters most here is what does NOT happen: a step with no
 * map, or a map that resolves to nothing, must be handed exactly the state it
 * would have been handed before any of this existed. Twenty-nine live
 * workflows depend on that.
 */
import { describe, expect, it } from 'vitest';
import { resolveInputs, withResolvedInputs } from './resolve-inputs.js';
import type { SyntraGraphState } from '../nodes/types.js';

const state = (over: Partial<SyntraGraphState> = {}): SyntraGraphState =>
  ({
    result: '',
    _emittedEvents: [],
    trigger_event: {
      event_id: 'e1',
      event_type: 'syntra.jd.received',
      organization_id: 'org-1',
      payload: { requirement_id: '8f14e45f-…', channel_type: 'EMAIL' },
    },
    profile: null,
    matches: [],
    agent_run_id: null,
    steps: {
      process: { jobId: '8f14e45f-…', status: 'processed' },
      normalize: { confidence: 0.92 },
    },
    ...over,
  }) as unknown as SyntraGraphState;

const payloadOf = (s: SyntraGraphState) =>
  s.trigger_event?.payload as Record<string, unknown>;

describe('resolveInputs', () => {
  it('reads a field off the trigger', () => {
    const { values } = resolveInputs(state(), { jobId: 'trigger.requirement_id' });
    expect(values).toEqual({ jobId: '8f14e45f-…' });
  });

  it('reads a field off an earlier step', () => {
    const { values } = resolveInputs(state(), { score: 'normalize.confidence' });
    expect(values).toEqual({ score: 0.92 });
  });

  it('renames as it goes — the point of a map', () => {
    // The node calls it jobId; the event calls it requirement_id. Without
    // this, nodes carry aliases in their own input schema to cope.
    const { values } = resolveInputs(state(), { jobId: 'trigger.requirement_id' });
    expect(values.jobId).toBe('8f14e45f-…');
  });

  it('reports a source that did not resolve, and omits the field', () => {
    // A step on a branch that was not taken. Not an error here: an optional
    // field can be absent, and a required one fails its own input schema next.
    const { values, unresolved } = resolveInputs(state(), {
      text: 'human.note',
    });
    expect(values).toEqual({});
    expect(unresolved).toEqual(['text ← human.note']);
  });

  it('never writes a key as undefined', () => {
    // A node must not be able to tell "not mapped" from "mapped to nothing",
    // and neither must its schema.
    const { values } = resolveInputs(state(), { missing: 'process.nope' });
    expect('missing' in values).toBe(false);
  });

  it('ignores a malformed path rather than throwing', () => {
    // The definition validator refuses these at save time; by the time a run
    // starts, throwing here would only turn a caught mistake into an outage.
    const { unresolved } = resolveInputs(state(), { x: 'process' });
    expect(unresolved).toEqual(['x ← process']);
  });
});

describe('withResolvedInputs', () => {
  it('hands back the same state when there is no map', () => {
    const s = state();
    const { state: out } = withResolvedInputs(s, undefined);
    expect(out).toBe(s);
  });

  it('hands back the same state when the map is empty', () => {
    const s = state();
    expect(withResolvedInputs(s, {}).state).toBe(s);
  });

  it('MERGES into the payload rather than replacing it', () => {
    // The whole safety argument. A partial map must not cost a step the
    // trigger fields it never thought to declare.
    const { state: out } = withResolvedInputs(state(), {
      jobId: 'process.jobId',
    });
    expect(payloadOf(out)).toEqual({
      requirement_id: '8f14e45f-…',
      channel_type: 'EMAIL',
      jobId: '8f14e45f-…',
    });
  });

  it('lets a mapped value win over a trigger field of the same name', () => {
    const s = state();
    (s.trigger_event as { payload: Record<string, unknown> }).payload.status =
      'from-trigger';
    const { state: out } = withResolvedInputs(s, { status: 'process.status' });
    expect(payloadOf(out).status).toBe('processed');
  });

  it('does not mutate the state it was given', () => {
    // Mutating would leak one step's mapping into the next, which is the
    // opposite of what a per-step map is for.
    const s = state();
    const before = JSON.stringify(s.trigger_event);
    withResolvedInputs(s, { jobId: 'process.jobId' });
    expect(JSON.stringify(s.trigger_event)).toBe(before);
  });

  it('leaves the payload alone when nothing resolved', () => {
    const s = state();
    const { state: out } = withResolvedInputs(s, { text: 'human.note' });
    expect(out).toBe(s);
  });

  it('copes with a run that has no context yet', () => {
    const s = state({ steps: undefined });
    const { state: out, unresolved } = withResolvedInputs(s, {
      jobId: 'process.jobId',
    });
    expect(out).toBe(s);
    expect(unresolved).toEqual(['jobId ← process.jobId']);
  });
});
