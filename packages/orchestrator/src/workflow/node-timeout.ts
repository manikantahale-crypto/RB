/**
 * How long a node may take, and what happens when it takes longer.
 *
 * Every contract declares `execution.timeoutMs` — the schema makes it
 * required — and until now nothing read it. The same story as the idempotency
 * key: a promise in the declaration that the runtime never kept. A node that
 * never returned held its run, its pg-boss job and the worker's one connection
 * for as long as the process lived, and the runs screen showed it RUNNING.
 *
 * WHERE THE LIMIT COMES FROM, in order:
 *
 *   1. the step's own config, `timeoutMs` — an author's override for one
 *      workflow, set in the editor without touching the contract
 *   2. the contract's `execution.timeoutMs` — what the node's author measured
 *   3. ORCH_NODE_TIMEOUT_MS — the floor for legacy engine functions, which
 *      declare nothing
 *   4. five minutes
 *
 * WHAT A TIMEOUT IS. Transient. The network may have stalled, SYNTRA may be
 * busy, the LLM may be slow: worth one more try with backoff, which is what
 * pg-boss does with a transient failure. The node's idempotency claim is
 * released on abort (see from-contract.ts), so the retry actually runs rather
 * than being skipped as "already in flight" for the fifteen-minute stale
 * window.
 *
 * WHAT A TIMEOUT IS NOT. A cancellation. JavaScript cannot stop a promise;
 * the runtime stops WAITING for it and aborts the signal it handed the node.
 * A node that forwards `ctx.signal` to its HTTP call stops promptly. One that
 * ignores it keeps running in the background until it settles, and whatever
 * it settles with is dropped.
 */
import { ClassifiedError } from './errors.js';

export const DEFAULT_NODE_TIMEOUT_MS = 5 * 60 * 1000;

export class NodeTimeoutError extends ClassifiedError {
  readonly timeoutMs: number;

  constructor(args: { nodeId: string; graphKey: string; timeoutMs: number }) {
    super(
      `node "${args.nodeId}" did not finish within ${args.timeoutMs}ms`,
      'transient',
      { nodeId: args.nodeId, graphKey: args.graphKey },
    );
    this.name = 'NodeTimeoutError';
    this.timeoutMs = args.timeoutMs;
  }
}

export function isNodeTimeout(err: unknown): err is NodeTimeoutError {
  return err instanceof NodeTimeoutError;
}

function positiveInt(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : undefined;
}

/** See the file header for the order. Pure: `env` is passed in, not read. */
export function resolveNodeTimeoutMs(args: {
  config?: Record<string, unknown>;
  declared?: number;
  env?: Record<string, string | undefined>;
}): number {
  return (
    positiveInt(args.config?.timeoutMs) ??
    positiveInt(args.declared) ??
    positiveInt(args.env?.ORCH_NODE_TIMEOUT_MS) ??
    DEFAULT_NODE_TIMEOUT_MS
  );
}

/**
 * Run `work` with a limit. Resolves with its value, or rejects with a
 * NodeTimeoutError once `timeoutMs` has passed — whichever comes first.
 *
 * The signal given to `work` is aborted on timeout, and only then: a node
 * that finishes in time never sees an aborted signal.
 */
export async function runWithTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  args: { timeoutMs: number; nodeId: string; graphKey: string },
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new NodeTimeoutError(args);
      controller.abort(err);
      reject(err);
    }, args.timeoutMs);
  });

  const attempt = work(controller.signal);
  // Whatever a timed-out node settles with later is nobody's business, but an
  // unobserved rejection would crash the worker.
  attempt.catch(() => {});

  try {
    return await Promise.race([attempt, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
