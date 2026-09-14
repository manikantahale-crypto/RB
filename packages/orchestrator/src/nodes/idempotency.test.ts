/**
 * The guard that stops one input having the same work done to it twice.
 *
 * The case it was written for: a workflow holding both `syntra.jd.process` and
 * `syntra.continuous.match`. The first publishes `syntra.jd.parsed`, which is
 * bound to a workflow that runs `syntra.continuous.match` too — so the bench is
 * searched twice for one requirement, two match jobs are opened, and nothing in
 * any log says so.
 */

import { describe, expect, it } from 'vitest';
import {
  claimExecution,
  idempotencyKeyOf,
  isDeduplicable,
  type DedupeClaim,
  type DedupeStore,
} from './idempotency.js';

/** Just the fields the guard reads. */
const node = (over: Record<string, unknown> = {}) =>
  ({
    key: 'syntra.continuous.match',
    sideEffect: 'internal_write',
    idempotency: { strategy: 'natural_key', keyPaths: ['jobId'] },
    ...over,
  }) as never;

const store = (claim: DedupeClaim, log: string[] = []): DedupeStore => ({
  claim: async () => {
    log.push('claim');
    return claim;
  },
  complete: async () => {
    log.push('complete');
  },
  release: async () => {
    log.push('release');
  },
});

describe('isDeduplicable', () => {
  it('covers internal writes that declare a key', () => {
    expect(isDeduplicable(node())).toBe(true);
  });

  it('covers external and financial steps too', () => {
    /*
     * These were excluded at first, on the grounds that a wrong suppression
     * costs more there. That protected the guard rather than the user and got
     * the arithmetic backwards: excluded, EVERY structural duplicate sends two
     * emails; included, one survives only if the process dies between sending
     * and recording. syntra.shortlist.notify is the live example.
     */
    expect(isDeduplicable(node({ sideEffect: 'external' }))).toBe(true);
    expect(isDeduplicable(node({ sideEffect: 'financial' }))).toBe(true);
  });

  it('does not bother with steps that change nothing', () => {
    expect(
      isDeduplicable(node({ sideEffect: 'read', idempotency: { strategy: 'pure' } })),
    ).toBe(false);
    expect(
      isDeduplicable(node({ sideEffect: 'control', idempotency: { strategy: 'pure' } })),
    ).toBe(false);
  });
});

describe('idempotencyKeyOf', () => {
  it('builds the key from the paths the contract declared', () => {
    expect(idempotencyKeyOf(node(), { jobId: 'req-1', other: 'ignored' })).toBe(
      '["req-1"]',
    );
  });

  it('reads a caller-supplied key when that is the strategy', () => {
    expect(
      idempotencyKeyOf(
        node({ idempotency: { strategy: 'idempotency_key', keyPath: 'meta.key' } }),
        { meta: { key: 'abc' } },
      ),
    ).toBe('["abc"]');
  });

  it('refuses a key it can only build half of', () => {
    /*
     * A partial key is worse than none: it collides across inputs that are
     * genuinely different, and the result is real work suppressed. No key
     * means the node runs, which is always the safe direction.
     */
    expect(
      idempotencyKeyOf(node({ idempotency: { strategy: 'natural_key', keyPaths: ['a', 'b'] } }), {
        a: 'present',
      }),
    ).toBeNull();
  });

  it('treats an empty string as missing', () => {
    expect(idempotencyKeyOf(node(), { jobId: '' })).toBeNull();
  });

  /**
   * The reason five of eight nodes derived no key at all.
   *
   * The contracts declared `["jobId"]` while every real payload carried
   * `requirement_id` — `syntra.jd.parsed` has no `jobId` at all — so the guard
   * fell open on `syntra.continuous.match`, which is the exact node in the
   * duplicate it was built to prevent.
   */
  describe('several names for one value', () => {
    const eitherName = node({
      idempotency: {
        strategy: 'natural_key',
        keyPaths: [['jobId', 'requirement_id']],
      },
    });

    it('reads whichever name the producer used', () => {
      expect(idempotencyKeyOf(eitherName, { requirement_id: 'R1' })).toBe('["R1"]');
    });

    it('gives the same key however the id arrived', () => {
      // The key is built from the VALUE, so an event naming it `jobId` and one
      // naming it `requirement_id` deduplicate against each other.
      expect(idempotencyKeyOf(eitherName, { jobId: 'R1' })).toBe(
        idempotencyKeyOf(eitherName, { requirement_id: 'R1' }),
      );
    });

    it('prefers the first name when a payload carries both', () => {
      // Deterministic rather than arbitrary: a generous producer must not make
      // the key depend on object key order.
      expect(
        idempotencyKeyOf(eitherName, { jobId: 'first', requirement_id: 'second' }),
      ).toBe('["first"]');
    });

    it('still refuses when none of the names are present', () => {
      expect(idempotencyKeyOf(eitherName, { candidateId: 'c1' })).toBeNull();
    });

    it('mixes alternatives and plain paths in one key', () => {
      // syntra.match.process: the job has two names, resumeId has one.
      const matchProcess = node({
        idempotency: {
          strategy: 'natural_key',
          keyPaths: [['jobId', 'requirement_id'], 'resumeId'],
        },
      });
      expect(
        idempotencyKeyOf(matchProcess, { requirement_id: 'R1', resumeId: 'CV9' }),
      ).toBe('["R1","CV9"]');
      // And all of it or none: a missing second part is still no key.
      expect(idempotencyKeyOf(matchProcess, { requirement_id: 'R1' })).toBeNull();
    });
  });

  it('cannot be fooled by a separator inside a value', () => {
    // ["a:b","c"] and ["a","b:c"] are different work and must not share a key.
    const two = (a: string, b: string) =>
      idempotencyKeyOf(
        node({ idempotency: { strategy: 'natural_key', keyPaths: ['x', 'y'] } }),
        { x: a, y: b },
      );
    expect(two('a:b', 'c')).not.toBe(two('a', 'b:c'));
  });
});

describe('claimExecution', () => {
  const base = {
    contract: node(),
    input: { jobId: 'req-1' },
    orgId: 'org-1',
    nodeId: 'match',
    correlationId: 'corr-1',
  };

  it('runs the node when nobody holds the key', async () => {
    const out = await claimExecution({ ...base, store: store({ kind: 'claimed' }) });
    expect(out.run).toBe(true);
    expect(out.key).toBe('["req-1"]');
  });

  it('skips work already done in this flow', async () => {
    const out = await claimExecution({
      ...base,
      store: store({ kind: 'already_done', byNodeId: 'process' }),
    });
    expect(out).toMatchObject({ run: false, reason: 'already_done' });
  });

  it('skips work another run is doing right now', async () => {
    // The duplicate arrives as a second, parallel run — so "in flight" is the
    // ordinary case, not the rare one.
    const out = await claimExecution({
      ...base,
      store: store({ kind: 'in_flight', byNodeId: 'match' }),
    });
    expect(out).toMatchObject({ run: false, reason: 'in_flight' });
  });

  it('runs without asking when the flow cannot be identified', async () => {
    /*
     * No correlation means no scope, and an unscoped key would suppress across
     * unrelated flows — two different people's requirements sharing one id.
     * Running is the only safe answer.
     */
    const log: string[] = [];
    const out = await claimExecution({
      ...base,
      correlationId: null,
      store: store({ kind: 'already_done', byNodeId: null }, log),
    });
    expect(out.run).toBe(true);
    expect(log).toEqual([]);
  });

  it('runs without asking when there is no store', async () => {
    const out = await claimExecution({ ...base, store: null });
    expect(out.run).toBe(true);
  });

  it('does not consult the store for a node it never deduplicates', async () => {
    const log: string[] = [];
    await claimExecution({
      ...base,
      // A control step writes nothing, so there is nothing to deduplicate and
      // no reason to spend a round trip finding that out.
      contract: node({ sideEffect: 'control', idempotency: { strategy: 'pure' } }),
      store: store({ kind: 'already_done', byNodeId: null }, log),
    });
    expect(log).toEqual([]);
  });

  it('separates two people doing the same thing at the same time', async () => {
    /*
     * Same event type, same requirement id, two different flows. The key is
     * identical; the correlation is not, so the store is asked about two
     * different rows and neither person's work is suppressed by the other's.
     */
    const asked: string[] = [];
    const recording: DedupeStore = {
      claim: async (a) => {
        asked.push(a.correlationId);
        return { kind: 'claimed' };
      },
      complete: async () => {},
      release: async () => {},
    };
    await claimExecution({ ...base, correlationId: 'corr-A', store: recording });
    await claimExecution({ ...base, correlationId: 'corr-B', store: recording });
    expect(asked).toEqual(['corr-A', 'corr-B']);
  });
});
