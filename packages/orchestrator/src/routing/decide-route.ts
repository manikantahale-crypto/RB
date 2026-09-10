import type { PlatformEventPlan } from './table.js';

/**
 * What the ingress router should do with one event.
 *
 * THE BINDING DECIDES. THE HARDCODED PLAN ONLY FILLS THE SILENCE.
 *
 * This used to be the other way round. `planForEvent` ran first, and anything
 * it did not return `graph` for was acknowledged and dropped BEFORE the binding
 * was ever read. It reads a hardcoded map of about twenty-six events; the
 * catalogue holds forty-five.
 *
 * So a workflow could be authored, bound, gate-checked and entirely correct,
 * and still never run — because its trigger was missing from a TypeScript
 * constant that needs an engine release to change. Seven of twenty live
 * bindings were in that state, two of them SYNTRA's own, and nothing anywhere
 * reported it: the event was accepted, logged as terminal, and dropped.
 *
 * It also contradicted the rule the router file's own header claims —
 * "database-only routing, no hardcoded event-to-graph fallback, ever again" —
 * because a hardcoded gate in FRONT of the database is that same fallback
 * wearing a different hat.
 *
 * The plan still earns its place on the other branch. With no binding, it
 * distinguishes an event deliberately handled elsewhere — `resume` for an
 * approval decision, `fail` for something to persist for replay — from an event
 * nobody has wired up at all. That distinction is worth keeping in the log.
 */
export type RouteDecision =
  | { kind: 'run'; graphKey: string; moduleQueue: string }
  | {
      /** Acknowledge and move on. `label` and `note` are for the story log. */
      kind: 'ack';
      label: string;
      note: string;
    };

export type ActiveBinding = {
  graph_key: string;
  module_queue: string;
};

/**
 * Where the outbox relay should send one event.
 *
 * THE RELAY IS THE FIRST GATE, AND FOR A LONG TIME THE ONLY ONE THAT MATTERED.
 *
 * It used to be a plain if/else on `planForEvent`: `graph` went to the ingress
 * router, everything else went to dispatch. An event sent to dispatch never
 * reaches the router at all — so fixing the router's precedence alone changed
 * nothing for the six bindings whose events the map calls `terminal` or `fail`.
 * They were never routed there to begin with.
 *
 * ADDITIVE, NOT A SWAP. Dispatch's duties are not optional and must not be
 * skipped just because a workflow is also bound:
 *
 *   - `resume` unparks a waiting human gate via the resume-thread queue
 *   - `fail`   records the run in orch.run_failures so it can be replayed
 *   - `terminal` acknowledges, which is all it ever did
 *
 * So a bound `fail` event now goes to BOTH: the failure is recorded AND the
 * retry workflow runs. That is the intent — a legitimate flow that can be
 * retried should be.
 */
export type RelayTargets = {
  /** Send to the ingress router, which will resolve the binding. */
  ingress: boolean;
  /** Send to dispatch for terminal / resume / fail handling. */
  dispatch: boolean;
};

export function decideRelayTargets(args: {
  plan: PlatformEventPlan;
  /** True when some active binding names this event. */
  bound: boolean;
}): RelayTargets {
  return {
    ingress: args.plan.kind === 'graph' || args.bound,
    dispatch: args.plan.kind !== 'graph',
  };
}

export function decideRoute(args: {
  eventType: string;
  organizationId: string | null;
  /** The active binding for this event, or null when there is none. */
  binding: ActiveBinding | null;
  /** What the hardcoded map says. Consulted only when there is no binding. */
  plan: PlatformEventPlan;
}): RouteDecision {
  if (args.binding) {
    return {
      kind: 'run',
      graphKey: args.binding.graph_key,
      moduleQueue: args.binding.module_queue,
    };
  }

  // No binding. The plan explains WHY nothing runs, which is the difference
  // between "handled somewhere else on purpose" and "nobody wired this up".
  if (args.plan.kind === 'graph') {
    return {
      kind: 'ack',
      label: 'UNROUTABLE',
      note: `${args.eventType}  org=${args.organizationId ?? '~global~'} — no active binding (ack)`,
    };
  }

  return {
    kind: 'ack',
    label: args.plan.kind.toUpperCase(),
    note: `${args.eventType} — ${args.plan.note} (ack, no graph)`,
  };
}
