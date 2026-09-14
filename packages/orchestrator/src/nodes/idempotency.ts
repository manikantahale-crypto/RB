/**
 * Enforcing the idempotency every node already declares.
 *
 * WHAT WAS WRONG. Every contract states how it behaves when run twice — it is a
 * required field, and the schema refuses a writing node that claims to be
 * `pure`. Nothing read it. It was documentation with a validator around it, and
 * the gap shows in the contracts themselves: `syntra.continuous.match` caps
 * retries at 1 instead of 3, which is only necessary because its declared key
 * is not enforced.
 *
 * WHAT GOES WRONG WITHOUT IT. A step publishes when it succeeds. If that event
 * is bound to another workflow, publishing starts a second run — so a workflow
 * holding both `syntra.jd.process` and `syntra.continuous.match` searches the
 * bench twice for one requirement: once as its own next step, once in the
 * workflow `syntra.jd.parsed` set going. Two match jobs, two sets of results,
 * nothing in any log saying so. Retries and replays produce the same shape.
 *
 * THE SCOPE IS ONE CAUSAL FLOW, and that choice is the whole design.
 *
 * `correlation_id` is stamped on the original event and carried onto everything
 * published downstream, so it names one chain of work from one real-world
 * cause. Keying on it means:
 *
 *   - the duplicate above collapses, wherever in the workflow it sits
 *   - a retry after a network blip does not redo the write
 *   - a replayed event does not redo it either
 *   - the SAME requirement arriving next week is a NEW flow, so it matches
 *     again — which is right, because the bench has changed
 *
 * That last line is why the scope is not "forever". A permanent key would
 * silently refuse legitimate re-work, and silently refusing work is the failure
 * this file exists to prevent, pointed the other way.
 *
 * NOTHING IS STORED BUT THE FACT. On a hit the step does not run and the run
 * carries on. There is no need to hand back the first result, because nothing
 * consumes it: every node builds its input from the trigger payload, and no
 * live workflow declares an `inputs` map that reads an earlier step's output.
 * So the record holds ids that are already in the outbox — no payload, no
 * output, no new class of data at rest.
 *
 * THE DAY THAT STOPS BEING TRUE is the day a workflow declares
 * `inputs: { resumeId: "process.resumeId" }`. Then a skipped step's output is
 * load-bearing and this must either store results or refuse to dedupe that
 * step. `checkDedupeSafeForInputs` in the platform checks is what notices.
 *
 * FAIL OPEN, ALWAYS. Every uncertainty here resolves to "run it": no
 * correlation, a key path that resolves to nothing, a strategy we do not
 * enforce yet. Running twice is visible and recoverable; not running is
 * neither.
 */
import type { AnyNodeContract } from '@tekisho/node-contract';
import { idempotencyKeyOf, isDeduplicable } from '@tekisho/node-contract';

/**
 * The policy itself lives in `@tekisho/node-contract`, not here.
 *
 * It reads two declared fields and nothing else, and the authoring API needs
 * the same answer — to tell an author whether a duplicate in their workflow is
 * absorbed or genuinely runs twice — while being unable to import the engine.
 * Re-exported so this module is still the one place to read about the guard.
 */
export { idempotencyKeyOf, isDeduplicable } from '@tekisho/node-contract';

/* ─────────────────────────── the store seam ──────────────────────────── */

export type DedupeClaim =
  /** Nobody held it. This run owns the work and must run the node. */
  | { kind: 'claimed' }
  /** Someone already did this work in this flow. Skip the node. */
  | { kind: 'already_done'; byNodeId: string | null }
  /** Another run holds it right now. Skip — the work is in hand. */
  | { kind: 'in_flight'; byNodeId: string | null };

/**
 * Where claims live. An interface so the decision is testable without a
 * database, the same reason `resolveRoutes` is pure.
 */
export type DedupeStore = {
  claim(args: {
    orgId: string;
    nodeKey: string;
    idempotencyKey: string;
    correlationId: string;
    nodeId: string;
  }): Promise<DedupeClaim>;
  /** The work finished. Nobody else in this flow should repeat it. */
  complete(args: {
    orgId: string;
    nodeKey: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<void>;
  /**
   * The work failed. Release the claim so a retry can take it.
   *
   * Without this a transient failure would permanently poison the key for the
   * rest of the flow — the node would never run again and the run would carry
   * on as if it had. That is the silent-omission failure, which is the one
   * outcome worse than doing the work twice.
   */
  release(args: {
    orgId: string;
    nodeKey: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<void>;
};

/**
 * Should this execution go ahead?
 *
 * Pulled out of the bridge so the whole decision can be read in one place and
 * tested without a graph, a node or a database.
 */
export async function claimExecution(args: {
  contract: Pick<AnyNodeContract, 'key' | 'sideEffect' | 'idempotency'>;
  input: Record<string, unknown>;
  orgId: string;
  nodeId: string;
  /** From the trigger event. Absent means the flow cannot be identified. */
  correlationId: string | null | undefined;
  store: DedupeStore | null;
}): Promise<
  | { run: true; key: string | null }
  | { run: false; key: string; reason: 'already_done' | 'in_flight' }
> {
  // No store wired, no correlation, or a node/key we do not enforce: run it.
  if (!args.store || !args.correlationId) return { run: true, key: null };

  const key = idempotencyKeyOf(args.contract, args.input);
  if (key === null) return { run: true, key: null };

  const claim = await args.store.claim({
    orgId: args.orgId,
    nodeKey: args.contract.key,
    idempotencyKey: key,
    correlationId: args.correlationId,
    nodeId: args.nodeId,
  });

  return claim.kind === 'claimed'
    ? { run: true, key }
    : { run: false, key, reason: claim.kind };
}
