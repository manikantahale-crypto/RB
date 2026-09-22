/**
 * The class decides whether a run is retried, so getting it wrong is not a
 * labelling problem — it is the difference between a workflow that recovers
 * when a service comes back and one that needs a person to replay it.
 *
 * The case that forced these: `syntra.match.workflow/process: fetch failed`,
 * recorded 95 times in three days as `permanent-system`, when node-api was
 * simply not running. Node's `fetch` rejects with `TypeError: fetch failed`,
 * and the rule for `TypeError` was written for `undefined is not a function`
 * — a real deployment fault — long before fetch behaved this way.
 */
import { describe, expect, it } from 'vitest';
import { ClassifiedError, classifyError } from './errors.js';

/** What Node really throws when nothing is listening on the port. */
function fetchFailed(code = 'ECONNREFUSED'): TypeError {
  const err = new TypeError('fetch failed');
  (err as { cause?: unknown }).cause = Object.assign(new Error('connect'), { code });
  return err;
}

describe('a service that is down', () => {
  it('is transient, so the run is retried rather than buried', () => {
    expect(classifyError(fetchFailed())).toBe('transient');
  });

  it('is transient for every connection failure undici reports', () => {
    for (const code of [
      'ECONNREFUSED',
      'ECONNRESET',
      'ENOTFOUND',
      'EAI_AGAIN',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'ETIMEDOUT',
      'UND_ERR_SOCKET',
      'UND_ERR_CONNECT_TIMEOUT',
    ]) {
      expect(classifyError(fetchFailed(code)), code).toBe('transient');
    }
  });

  it('is transient even when the cause carries no code', () => {
    // Some shapes arrive as a bare TypeError with only the message.
    expect(classifyError(new TypeError('fetch failed'))).toBe('transient');
  });

  it('reads a socket hang up the same way', () => {
    expect(classifyError(new Error('socket hang up'))).toBe('transient');
  });
});

describe('a real code fault is still permanent-system', () => {
  it('does not let the new rule swallow a genuine TypeError', () => {
    // This is what the TypeError rule was written for, and it must survive.
    expect(classifyError(new TypeError('x is not a function'))).toBe(
      'permanent-system',
    );
    expect(
      classifyError(new TypeError("Cannot read properties of undefined (reading 'id')")),
    ).toBe('permanent-system');
    expect(classifyError(new ReferenceError('thing is not defined'))).toBe(
      'permanent-system',
    );
  });

  it('keeps the definition invariants where they were', () => {
    expect(classifyError(new Error('DEFINITION_INVALID: duplicate node id'))).toBe(
      'permanent-system',
    );
    expect(classifyError(new Error('Node implementation not found: x.y'))).toBe(
      'permanent-system',
    );
  });
});

describe('an error that already knows its own class', () => {
  it('is taken at its word — this is how a node contract is heard', () => {
    const judged = new ClassifiedError('fetch failed', 'transient', {
      nodeId: 'process',
      graphKey: 'syntra.match.workflow',
    });
    expect(classifyError(judged)).toBe('transient');
  });

  it('is taken at its word even when the message says otherwise', () => {
    const judged = new ClassifiedError('DEFINITION_INVALID: whatever', 'permanent-input');
    expect(classifyError(judged)).toBe('permanent-input');
  });
});
