/**
 * The contract's time limit, enforced.
 *
 * Two things must be true: the limit comes from the right place, and running
 * out of it is a transient failure that aborts the signal the node was given
 * — not a hang, and not a permanent verdict on the input.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NODE_TIMEOUT_MS,
  NodeTimeoutError,
  isNodeTimeout,
  resolveNodeTimeoutMs,
  runWithTimeout,
} from './node-timeout.js';
import { classifyError } from './errors.js';

describe('resolveNodeTimeoutMs — where the limit comes from', () => {
  it('the step config overrides the contract', () => {
    expect(resolveNodeTimeoutMs({ config: { timeoutMs: 1_000 }, declared: 60_000 })).toBe(1_000);
  });

  it('the contract overrides the environment', () => {
    expect(
      resolveNodeTimeoutMs({ declared: 60_000, env: { ORCH_NODE_TIMEOUT_MS: '9000' } }),
    ).toBe(60_000);
  });

  it('a legacy engine function, declaring nothing, gets the environment floor', () => {
    expect(resolveNodeTimeoutMs({ env: { ORCH_NODE_TIMEOUT_MS: '9000' } })).toBe(9_000);
  });

  it('and five minutes when the environment says nothing either', () => {
    expect(resolveNodeTimeoutMs({})).toBe(DEFAULT_NODE_TIMEOUT_MS);
  });

  it('ignores a value that is not a positive whole number of milliseconds', () => {
    expect(resolveNodeTimeoutMs({ config: { timeoutMs: 0 }, declared: 500 })).toBe(500);
    expect(resolveNodeTimeoutMs({ config: { timeoutMs: -5 }, declared: 500 })).toBe(500);
    expect(resolveNodeTimeoutMs({ config: { timeoutMs: 'soon' }, declared: 500 })).toBe(500);
    expect(resolveNodeTimeoutMs({ env: { ORCH_NODE_TIMEOUT_MS: 'abc' } })).toBe(
      DEFAULT_NODE_TIMEOUT_MS,
    );
  });
});

describe('runWithTimeout — what running out of time means', () => {
  const where = { nodeId: 'process', graphKey: 'syntra.jd.workflow' };

  it('a node that finishes in time returns its value and never sees an abort', async () => {
    let sawAbort = false;
    const value = await runWithTimeout(
      async (signal) => {
        signal.addEventListener('abort', () => {
          sawAbort = true;
        });
        return 'done';
      },
      { ...where, timeoutMs: 1_000 },
    );
    expect(value).toBe('done');
    expect(sawAbort).toBe(false);
  });

  it('a node that never returns fails with a NodeTimeoutError and its signal is aborted', async () => {
    let given: AbortSignal | undefined;
    const attempt = runWithTimeout(
      (signal) =>
        new Promise<never>(() => {
          given = signal;
        }),
      { ...where, timeoutMs: 20 },
    );
    await expect(attempt).rejects.toBeInstanceOf(NodeTimeoutError);
    expect(given?.aborted).toBe(true);
    expect(given?.reason).toBeInstanceOf(NodeTimeoutError);
  });

  it('a timeout is transient — worth a retry, not a verdict on the input', async () => {
    const err = new NodeTimeoutError({ ...where, timeoutMs: 20 });
    expect(err.errorClass).toBe('transient');
    expect(classifyError(err)).toBe('transient');
    expect(isNodeTimeout(err)).toBe(true);
    expect(err.message).toContain('process');
    expect(err.message).toContain('20ms');
  });

  it('a node that fails on its own keeps its own error', async () => {
    await expect(
      runWithTimeout(async () => {
        throw new Error('Syntra /x failed: 404 not here');
      }, { ...where, timeoutMs: 1_000 }),
    ).rejects.toThrow('404 not here');
  });

  it('a late result from a timed-out node is dropped, not crashed on', async () => {
    let finishLate: (() => void) | undefined;
    const attempt = runWithTimeout(
      () =>
        new Promise<never>((_, reject) => {
          finishLate = () => reject(new Error('late failure'));
        }),
      { ...where, timeoutMs: 10 },
    );
    await expect(attempt).rejects.toBeInstanceOf(NodeTimeoutError);
    // Settling after the deadline must not surface anywhere.
    finishLate?.();
    await new Promise((r) => setTimeout(r, 5));
  });
});
