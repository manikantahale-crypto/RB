/**
 * The envelope RELAY puts under `tool_result` in the events it publishes
 * (relay.email.classified, relay.consent.completed, …). The catalogue rows for
 * those events declare it (V20260909.68), so the shape is kept as it was.
 *
 * It used to come from @tekisho/domain on the old project as
 * `buildToolResult`. This repo never had it: nodes here do not chain payloads
 * (ref/Orchestrator_Decisions.md), so a shared "merge tool output into the
 * next node's input" helper has no place in the platform. What remains is
 * RELAY's own payload shape, so it lives with RELAY.
 */
export type NodeToolStatus = 'ok' | 'failed' | 'stubbed';

export interface NodeToolResultEnvelope {
  /** Runtime tool impl key (relay.*). */
  node: string;
  /** Platform event type that activated this node. */
  event_on: string;
  status: NodeToolStatus;
  /** Tool-specific output — body, email, thread_id, sent_count, … */
  result: Record<string, unknown>;
  /** Platform event type this tool emits as follow-on (if any). */
  emits?: string;
}

export function buildToolResult(
  node: string,
  eventOn: string,
  status: NodeToolStatus,
  result: Record<string, unknown>,
  emits?: string,
): NodeToolResultEnvelope {
  return { node, event_on: eventOn, status, result, emits };
}
