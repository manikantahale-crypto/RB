/**
 * The bridge between a node contract and the graph runtime.
 *
 * A node contract declares `run(ctx, input, config)`. LangGraph calls
 * `(state, ctx) => Partial<State>`. This adapts one to the other, and it is
 * the only place in the runtime that knows both shapes.
 *
 * The decision this file encodes: the declared `input` is REAL.
 * It is parsed from the trigger event payload before `run` is called, and the
 * declared `output` is parsed on the way back. The alternative — handing the
 * node the whole graph state and ignoring what it declared — would have made
 * `input`, `output` and every fixture decoration, and would have left run
 * detail redacting a shape nothing guarantees.
 *
 * Consequences worth knowing:
 * - A payload that does not satisfy the node's input schema fails HERE, with
 *   the node's own field names, before any HTTP call is made.
 * - A node returning something its own contract does not describe fails too.
 *   Better a loud failure than a registry row that quietly lies.
 *
 * EXCEPT FOR THE FIELDS IT DOES NOT FAIL ON. Parsing an object against a zod
 * schema STRIPS keys the schema does not name rather than rejecting them, so a
 * node returning a field it never declared does not fail loudly — the field is
 * silently deleted on the way to `steps`. Nothing downstream can read it, and
 * because input maps are now worked out from these same declarations, it is a
 * connection that can never be made. That is drift between what a node does
 * and what it says, it is invisible by construction, and the only place it can
 * be seen is here, where both are in hand. So it is logged.
 */
import { undeclaredFields, type AnyNodeContract } from '@tekisho/node-contract';
import { ClassifiedError } from '../workflow/errors.js';
import type { NodeCtx, NodeImpl } from './types.js';
import { claimExecution, isDeduplicable } from './idempotency.js';
import { pgDedupeStore } from './idempotency-store.js';

/**
 * THE CLASS THE NODE ITSELF DECLARED, WHICH NOTHING USED TO ASK FOR.
 *
 * Every contract carries `execution.classifyError`, and the module nodes all
 * point it at `classifyModuleError` — which reads an HTTP status out of the
 * message and decides retryable from not. None of it ever ran: the engine
 * classified with its own `classifyError` and no code path consulted the
 * contract's. Thirty-three contracts declared retry behaviour that did
 * nothing.
 *
 * Wrapping in `ClassifiedError` is how the answer survives the journey:
 * `classifyError` returns `err.errorClass` on sight of one, so the node's own
 * judgement reaches the runner unchanged instead of being re-derived from the
 * message.
 *
 * A node that declares nothing is left alone, so the engine's rules still
 * apply — this adds an opinion where one was offered, it does not replace the
 * default with silence.
 *
 * The two vocabularies differ by a punctuation mark: contracts say
 * `permanent_input`, the engine says `permanent-input`. Mapped here rather
 * than changed in either, because both names are already stored — the engine's
 * in `orch.run_failures.error_class`, the contract's in `node_registry`.
 */
function classifiedByContract(
  contract: AnyNodeContract,
  ctx: NodeCtx,
  err: unknown,
): unknown {
  const classify = contract.execution?.classifyError;
  if (typeof classify !== 'function') return err;
  // Already judged further in; the innermost opinion is the informed one.
  if (err instanceof ClassifiedError) return err;

  let declared: string;
  try {
    declared = classify(err);
  } catch {
    // A classifier that throws must not replace the error it was judging.
    return err;
  }

  const errorClass =
    declared === 'transient'
      ? 'transient'
      : declared === 'permanent_input'
        ? 'permanent-input'
        : declared === 'permanent_system'
          ? 'permanent-system'
          : null;
  if (!errorClass) return err;

  return new ClassifiedError(
    err instanceof Error ? err.message : String(err),
    errorClass,
    { nodeId: ctx.nodeId, graphKey: ctx.graphKey, cause: err },
  );
}

/** Turn a contract into something the graph compiler can run. */
export function toNodeImpl(contract: AnyNodeContract): NodeImpl {
  const impl: NodeImpl = async (state, ctx) => {
    const trigger = state.trigger_event;
    if (!trigger) {
      throw new Error(
        `${contract.key}: no trigger event on state — a node's input is built from the trigger payload`,
      );
    }

    const input = parseOrThrow(contract.key, 'input', contract.input, trigger.payload ?? {});
    const config = parseOrThrow(contract.key, 'config', contract.config, ctx.config ?? {});

    // The node names an event; the runtime builds the envelope around it —
    // including the id, which is derived from run + step + type + position
    // (ctx.ts) so a re-run step emits the same event rather than a second.
    const emit = (event: { event_type: string; payload: Record<string, unknown> }) => {
      ctx.events.emit({
        event_type: event.event_type,
        aggregate_id: trigger.aggregate_id,
        aggregate_type: trigger.aggregate_type,
        organization_id: trigger.organization_id,
        correlation_id: trigger.correlation_id,
        payload: event.payload,
      });
    };

    /**
     * HAS THIS WORK ALREADY BEEN DONE IN THIS FLOW?
     *
     * Every contract declares an idempotency key and nothing read it. Meanwhile
     * a step that publishes can start another workflow that runs the same step,
     * so one requirement got matched twice — once here, once there, with
     * nothing in any log saying so. See `idempotency.ts` for the whole argument.
     *
     * Placed AFTER input parsing because the key is derived from the parsed
     * input, and BEFORE `run` because the point is not to make the call.
     */
    const dedupe = await claimOrSkip(contract, input, ctx, trigger);
    if (!dedupe.run) {
      /**
       * Skipped, and said so in the run's own record rather than silently.
       *
       * No events are emitted, which is the point — emitting here would start
       * whatever the real execution already started, and turn a suppressed
       * duplicate into a duplicated fan-out.
       *
       * `steps` is left unset. Nothing reads an earlier step's output today,
       * and writing an empty one would let a future reader mistake "skipped"
       * for "ran and produced nothing".
       */
      return {
        result:
          `${contract.key}: skipped — ${
            dedupe.reason === 'already_done'
              ? 'already done in this flow'
              : 'already running in this flow'
          }`,
      };
    }

    let output: unknown;
    try {
      output = await untilAborted(
        contract.run(
          {
            orgId: ctx.orgId,
            logger: ctx.logger,
            emit,
            signal: ctx.signal,
            correlationId: trigger.correlation_id ?? null,
          },
          input,
          config,
        ),
        ctx.signal,
      );
    } catch (err) {
      /**
       * The work did not happen, so the claim must not outlive the attempt.
       * Left in place, the key would be dead for the rest of the flow and the
       * step would never run — the silent omission, which is the one outcome
       * worse than doing the work twice.
       *
       * This includes a TIMEOUT. The runtime stops waiting and aborts the
       * signal; `untilAborted` rejects here at once, the claim is released,
       * and the retry pg-boss schedules can actually run the step instead of
       * finding it "in flight" for the fifteen-minute stale window.
       */
      await releaseQuietly(dedupe, contract, ctx, trigger);
      throw classifiedByContract(contract, ctx, err);
    }

    await completeQuietly(dedupe, contract, ctx, trigger);

    const checked = parseOrThrow(contract.key, 'output', contract.output, output);
    /**
     * Top level only: an input map names a field of a step, never a path
     * inside one, so that is the level at which a dropped key costs something.
     * A warning rather than a throw — the run is fine, the DECLARATION is
     * wrong, and failing a live workflow over a field nobody was reading would
     * be a worse trade than saying so.
     */
    const dropped = undeclaredFields(output, checked);
    if (dropped.length > 0) {
      ctx.logger?.error?.(
        `${contract.key}: returned ${dropped.join(', ')} — not in its declared output, ` +
          `so it was dropped and nothing downstream can be wired to it`,
        { nodeId: ctx.nodeId, graphKey: ctx.graphKey, undeclared: dropped },
      );
    }
    /**
     * Filed under the STEP id, not the node key: the same implementation runs
     * at several ids across graphs, and a later step refers to the position it
     * wants — `process.jobId` — not to the implementation that happened to fill
     * it.
     *
     * Nothing reads this yet. Writing it is separable from resolving it, and
     * landing them together would have made a behaviour change out of what is
     * currently an addition.
     */
    /**
     * A control node chooses a path by writing `branch_key`; the compiler's
     * conditional edges read it from the state. Until now the bridge dropped
     * it, which is why the two platform control nodes stayed engine
     * functions (adapters/index.ts). Carried only when the DECLARED output
     * has it: a node that does not name an arm cannot steer the run by
     * accident.
     */
    const branchKey =
      checked && typeof checked === 'object' && typeof checked.branch_key === 'string'
        ? (checked.branch_key as string)
        : undefined;

    return {
      result: `${contract.key}: ${summarize(checked)}`,
      steps: { [ctx.nodeId]: checked },
      ...(branchKey !== undefined ? { branch_key: branchKey } : {}),
    };
  };

  // What the contract declared about running itself, where the compiler can
  // read it without knowing what a contract is.
  // Optional-chained for the tests that hand this a contract-shaped stub.
  const declaredTimeout = contract.execution?.timeoutMs;
  if (typeof declaredTimeout === 'number') {
    impl.execution = { timeoutMs: declaredTimeout };
  }
  if (contract.config && typeof contract.config.safeParse === 'function') {
    impl.configSchema = contract.config;
  }
  return impl;
}

/**
 * Settle with the work, or reject the moment the signal aborts — whichever
 * is first. A node that ignores its signal keeps running in the background;
 * this makes sure nothing here waits for it.
 */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() =>
      signal.removeEventListener('abort', onAbort),
    );
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(`aborted: ${String(signal.reason ?? 'no reason given')}`);
}

/* ─────────────────────── the duplicate-work guard ────────────────────── */

/**
 * What a claim attempt left us holding, so success and failure can finish it.
 *
 * `key` is null whenever nothing was claimed — a node we do not deduplicate, a
 * key that could not be derived, no correlation, or a store that was not
 * reachable. Then the two finishers have nothing to do.
 */
type DedupeOutcome =
  | { run: true; key: string | null }
  | { run: false; key: string; reason: 'already_done' | 'in_flight' };

/**
 * EVERY FAILURE HERE MEANS "RUN THE NODE".
 *
 * The table may not exist yet, the role may lack a grant, the connection may
 * be busy. None of those are reasons to skip work, and all of them would be if
 * this threw. Doing the work twice is visible and recoverable; not doing it is
 * neither — so the guard turns itself off rather than becoming a new way for a
 * run to fail.
 */
async function claimOrSkip(
  contract: AnyNodeContract,
  input: Record<string, unknown>,
  ctx: NodeCtx,
  trigger: { correlation_id?: string | null },
): Promise<DedupeOutcome> {
  if (!isDeduplicable(contract)) return { run: true, key: null };
  try {
    return await ctx.db.withOrg(async (client) =>
      claimExecution({
        contract,
        input,
        orgId: ctx.orgId,
        nodeId: ctx.nodeId,
        correlationId: trigger.correlation_id ?? null,
        store: pgDedupeStore(client),
      }),
    );
  } catch (err) {
    /**
     * Optional-chained on purpose. This handler is the fail-open path, and a
     * handler that can itself throw — a ctx without a logger, in a test or a
     * stub — would turn "run the node anyway" back into "the run dies", which
     * is the exact outcome the catch exists to prevent.
     */
    ctx.logger?.error?.(
      `${contract.key}: idempotency check unavailable, running anyway`,
      err,
    );
    return { run: true, key: null };
  }
}

async function completeQuietly(
  outcome: DedupeOutcome,
  contract: AnyNodeContract,
  ctx: NodeCtx,
  trigger: { correlation_id?: string | null },
): Promise<void> {
  if (!outcome.run || !outcome.key || !trigger.correlation_id) return;
  try {
    await ctx.db.withOrg((client) =>
      pgDedupeStore(client).complete({
        orgId: ctx.orgId,
        nodeKey: contract.key,
        idempotencyKey: outcome.key!,
        correlationId: trigger.correlation_id!,
      }),
    );
  } catch (err) {
    /**
     * The work HAPPENED and we failed to record that it did. The claim is left
     * `running`, so it is taken over after the stale window and the step could
     * run a second time — the fault this file exists to prevent, arriving by
     * the back door. Loud, because it is the one failure here that is not safe.
     */
    ctx.logger?.error?.(
      `${contract.key}: ran but could not mark its idempotency claim done — ` +
        `this work may be repeated in this flow`,
      err,
    );
  }
}

async function releaseQuietly(
  outcome: DedupeOutcome,
  contract: AnyNodeContract,
  ctx: NodeCtx,
  trigger: { correlation_id?: string | null },
): Promise<void> {
  if (!outcome.run || !outcome.key || !trigger.correlation_id) return;
  try {
    await ctx.db.withOrg((client) =>
      pgDedupeStore(client).release({
        orgId: ctx.orgId,
        nodeKey: contract.key,
        idempotencyKey: outcome.key!,
        correlationId: trigger.correlation_id!,
      }),
    );
  } catch {
    // The node's own error is what matters and is about to be rethrown. A
    // stranded claim is recovered by the stale window.
  }
}

/** Parse against a declared schema, saying which node and which side failed. */
function parseOrThrow(
  key: string,
  where: 'input' | 'config' | 'output',
  schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } },
  value: unknown,
): any {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = (result.error as { issues?: Array<{ path: unknown[]; message: string }> })
      ?.issues;
    const detail = issues
      ? issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
      : String(result.error);
    throw new Error(`NODE_${where.toUpperCase()}_INVALID: ${key} — ${detail}`);
  }
  return result.data;
}

/**
 * `state.result` is a human-readable breadcrumb; nothing branches on it. Prefer
 * the node's own `status` when it declares one.
 */
function summarize(output: unknown): string {
  if (output && typeof output === 'object') {
    const status = (output as Record<string, unknown>).status;
    if (typeof status === 'string') return status;
  }
  return 'ok';
}