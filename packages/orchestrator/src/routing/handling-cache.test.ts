/**
 * The catalogue decides what happens to an event; the compiled map is the floor.
 *
 * The behaviour being protected here is the one that silently killed RELAY's
 * two active bindings: an event the engine had never heard of was acknowledged
 * and dropped, however correct the workflow bound to it was. Registering an
 * event should be a row, not a release — and getting that wrong is invisible,
 * because nothing errors.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  catalogueState,
  loadEventHandling,
  resetEventHandling,
  type Queryable,
} from './handling-cache.js';
import { planForEvent } from './table.js';

/** A database that answers with `rows`, or throws if `fail` is set. */
function db(rows: Array<{ event_type: string; handling: string }>, fail = false): Queryable {
  return {
    query: async () => {
      if (fail) throw new Error('connection refused');
      return { rows: rows as never[] };
    },
  };
}

beforeEach(() => resetEventHandling());

describe('before the catalogue is loaded', () => {
  it('answers from the compiled map, exactly as it always did', () => {
    expect(planForEvent('syntra.jd.received').kind).toBe('graph');
    expect(planForEvent('syntra.match.completed').kind).toBe('terminal');
  });

  it('acks an unknown event rather than failing the job', () => {
    // Deliberately kept: "terminal" acknowledges the event. The fix for a
    // dropped event is a catalogue row, not a crashed worker.
    expect(planForEvent('nobody.has.heard.of.this').kind).toBe('terminal');
  });
});

describe('once the catalogue is loaded', () => {
  it('routes an event the compiled map has never heard of', async () => {
    // The whole point. This event is in none of the 26 hardcoded entries, so
    // before this change it was acknowledged and dropped.
    await loadEventHandling(db([{ event_type: 'relay.consent.granted', handling: 'graph' }]));
    expect(planForEvent('relay.consent.granted').kind).toBe('graph');
  });

  it('overrides the compiled map, because the database is what an operator can change', async () => {
    expect(planForEvent('syntra.match.completed').kind).toBe('terminal');
    await loadEventHandling(db([{ event_type: 'syntra.match.completed', handling: 'graph' }]));
    expect(planForEvent('syntra.match.completed').kind).toBe('graph');
  });

  it('still falls back to the map for events the catalogue omits', async () => {
    await loadEventHandling(db([{ event_type: 'relay.consent.granted', handling: 'graph' }]));
    expect(planForEvent('syntra.jd.received').kind).toBe('graph');
    expect(planForEvent('syntra.match.completed').kind).toBe('terminal');
  });

  it('carries every handling kind, not just graph and terminal', async () => {
    await loadEventHandling(
      db([
        { event_type: 'a.resume', handling: 'resume' },
        { event_type: 'a.fail', handling: 'fail' },
      ]),
    );
    expect(planForEvent('a.resume').kind).toBe('resume');
    expect(planForEvent('a.fail').kind).toBe('fail');
  });

  it('ignores a handling value outside the four', async () => {
    // The column has a CHECK, so this only happens if somebody edited the
    // catalogue by hand. Trusting it would put an unroutable value on the hot
    // path; ignoring it falls back to the map.
    await loadEventHandling(db([{ event_type: 'syntra.jd.received', handling: 'nonsense' }]));
    expect(planForEvent('syntra.jd.received').kind).toBe('graph');
  });

  it('says how many events it learned', async () => {
    const n = await loadEventHandling(
      db([
        { event_type: 'one', handling: 'graph' },
        { event_type: 'two', handling: 'terminal' },
      ]),
    );
    expect(n).toBe(2);
    expect(catalogueState()).toMatchObject({ loaded: true, events: 2 });
  });
});

describe('when the database cannot be reached', () => {
  it('does not throw, so the worker still starts', async () => {
    await expect(loadEventHandling(db([], true))).resolves.toBe(0);
    expect(planForEvent('syntra.jd.received').kind).toBe('graph');
  });

  it('keeps the previous catalogue rather than emptying it', async () => {
    // A worker that has been routing correctly for a week must not start
    // dropping events because one refresh timed out.
    await loadEventHandling(db([{ event_type: 'relay.consent.granted', handling: 'graph' }]));
    await loadEventHandling(db([], true));

    expect(planForEvent('relay.consent.granted').kind).toBe('graph');
    expect(catalogueState().events).toBe(1);
  });
});
