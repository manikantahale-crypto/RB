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
 */
import { v4 as uuidv4 } from 'uuid';
import type { AnyNodeContract } from '@tekisho/node-contract';
import type { NodeCtx, NodeImpl } from './types.js';
import { claimExecution, isDeduplicable } from './idempotency.js';
import { pgDedupeStore } from './idempotency-store.js';

/** Turn a contract into something the graph compiler can run. */
export function toNodeImpl(contract: AnyNodeContract): NodeImpl {
  return async (state, ctx) => {
    const trigger = state.trigger_event;
    if (!trigger) {
      throw new Error(
        `${contract.key}: no trigger event on state — a node's input is built from the trigger payload`,
      );
    }

    const input = parseOrThrow(contract.key, 'input', contract.input, trigger.payload ?? {});
    const config = parseOrThrow(contract.key, 'config', contract.config, ctx.config ?? {});

    // The node names an event; the runtime builds the envelope around it.
    const emit = (event: { event_type: string; payload: Record<string, unknown> }) => {
      ctx.events.emit({
        event_id: uuidv4(),
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
      output = await contract.run(
        { orgId: ctx.orgId, logger: ctx.logger, emit },
        input,
        config,
      );
    } catch (err) {
      /**
       * The work did not happen, so the claim must not outlive the attempt.
       * Left in place, the key would be dead for the rest of the flow and the
       * step would never run — the silent omission, which is the one outcome
       * worse than doing the work twice.
       */
      await releaseQuietly(dedupe, contract, ctx, trigger);
      throw err;
    }

    await completeQuietly(dedupe, contract, ctx, trigger);

    const checked = parseOrThrow(contract.key, 'output', contract.output, output);
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
    return {
      result: `${contract.key}: ${summarize(checked)}`,
      steps: { [ctx.nodeId]: checked },
    };
  };
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