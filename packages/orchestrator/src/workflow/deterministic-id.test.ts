/**
 * The same emission gets the same id; a different one never does.
 */
import { describe, expect, it } from 'vitest';
import { deterministicEventId, uuidV5 } from './deterministic-id.js';
import { createNodeCtx } from '../nodes/ctx.js';

const V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('deterministicEventId', () => {
  const at = { runKey: 'org-1:evt-1', nodeId: 'gate', eventType: 'syntra.approval.requested', index: 0 };

  it('is a version-5 UUID, and the same one every time', () => {
    const a = deterministicEventId(at);
    expect(a).toMatch(V5);
    expect(deterministicEventId({ ...at })).toBe(a);
    expect(uuidV5('anything')).toMatch(V5);
  });

  it('changes when the run, the step, the type or the position changes', () => {
    const a = deterministicEventId(at);
    expect(deterministicEventId({ ...at, runKey: 'org-1:evt-2' })).not.toBe(a);
    expect(deterministicEventId({ ...at, nodeId: 'gate2' })).not.toBe(a);
    expect(deterministicEventId({ ...at, eventType: 'other' })).not.toBe(a);
    expect(deterministicEventId({ ...at, index: 1 })).not.toBe(a);
  });

  it('is pinned — a change here would re-identify every event in the outbox', () => {
    expect(deterministicEventId(at)).toBe('33439d1a-a95b-5449-b2e6-b7806269ebd6');
  });
});

describe('createNodeCtx — emitting without an id', () => {
  const base = { orgId: 'org-1', nodeId: 'gate', runKey: 'org-1:evt-1' };
  const ev = (type: string) => ({
    event_type: type,
    aggregate_id: 'a',
    aggregate_type: 'requirement',
    organization_id: 'org-1',
    correlation_id: 'c',
    payload: {},
  });

  it('derives the id, and a rebuilt context derives the same one', () => {
    const first = createNodeCtx(base);
    first.ctx.events.emit(ev('x.happened'));
    const again = createNodeCtx(base);
    again.ctx.events.emit(ev('x.happened'));
    const [a] = first.drainEvents();
    const [b] = again.drainEvents();
    expect(a!.event_id).toMatch(V5);
    expect(b!.event_id).toBe(a!.event_id);
  });

  it('numbers a second emission of the same type, and keeps types apart', () => {
    const { ctx, drainEvents } = createNodeCtx(base);
    ctx.events.emit(ev('x.happened'));
    ctx.events.emit(ev('x.happened'));
    ctx.events.emit(ev('y.happened'));
    const ids = drainEvents().map((e) => e.event_id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[1]).toBe(
      deterministicEventId({ runKey: base.runKey, nodeId: 'gate', eventType: 'x.happened', index: 1 }),
    );
  });

  it('keeps an id a node supplied, and is random with no run key', () => {
    const { ctx, drainEvents } = createNodeCtx(base);
    ctx.events.emit({ ...ev('x.happened'), event_id: 'given' });
    expect(drainEvents()[0]!.event_id).toBe('given');

    const loose = createNodeCtx({ orgId: 'org-1', nodeId: 'gate' });
    loose.ctx.events.emit(ev('x.happened'));
    loose.ctx.events.emit(ev('x.happened'));
    const [p, q] = loose.drainEvents();
    expect(p!.event_id).not.toBe(q!.event_id);
    expect(p!.event_id).not.toMatch(V5);
  });
});
