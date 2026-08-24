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
import type { NodeImpl } from './types.js';

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

    const output = await contract.run(
      { orgId: ctx.orgId, logger: ctx.logger, emit },
      input,
      config,
    );

    const checked = parseOrThrow(contract.key, 'output', contract.output, output);
    return { result: `${contract.key}: ${summarize(checked)}` };
  };
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