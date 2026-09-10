import { EVENT_TYPES } from '@tekisho/domain';
import { handlingFromCatalogue } from './handling-cache.js';

/**
 * Platform event metadata for workers (terminals / queues).
 *
 * Graph routing for ingress is NOT here — see `graph_event_bindings` (DB).
 * The router resolves event_type → graph_key + module_queue only from that table.
 * Seed rows cover day-1 Syntra; admin Activate upserts authoring bindings.
 */

export type EventHandleKind = 'graph' | 'terminal' | 'resume' | 'fail';

export type PlatformEventPlan = {
  kind: EventHandleKind;
  note: string;
};

export const PLATFORM_EVENT_PLAN: Record<string, PlatformEventPlan> = {
  [EVENT_TYPES.JD_RECEIVED]: {
    kind: 'graph',
    note: 'Trigger — routed via graph_event_bindings (DB)',
  },
  [EVENT_TYPES.JD_PARSED]: {
    kind: 'graph',
    note: 'Trigger — routed via graph_event_bindings (continuous match)',
  },
  /** ASTRA route bridge — must be graph or ingress silently terminal-acks. */
  [EVENT_TYPES.JD_NORMALIZED]: {
    kind: 'graph',
    note: 'ASTRA bridge — routed via graph_event_bindings (DB)',
  },
  // Literal duplicate so a stale @tekisho/domain without JD_NORMALIZED
  // cannot collapse this key to "undefined" and terminal-ack the bridge.
  'syntra.jd.normalized': {
    kind: 'graph',
    note: 'ASTRA bridge — routed via graph_event_bindings (DB)',
  },
  [EVENT_TYPES.RESUME_RECEIVED]: {
    kind: 'graph',
    note: 'Trigger — routed via graph_event_bindings (DB)',
  },
  [EVENT_TYPES.PROFILE_PREPARED]: {
    kind: 'graph',
    note: 'Trigger — routed via graph_event_bindings (duplicate detect)',
  },
  [EVENT_TYPES.DUPLICATE_REVIEW_REQUIRED]: {
    kind: 'graph',
    note: 'Control — routed via graph_event_bindings (DB)',
  },
  [EVENT_TYPES.MATCH_REQUESTED]: {
    kind: 'graph',
    note: 'Trigger — routed via graph_event_bindings (DB)',
  },
  [EVENT_TYPES.MATCH_COMPLETED]: {
    kind: 'terminal',
    note: 'Outcome of match — UI / audit only',
  },
  [EVENT_TYPES.APPROVAL_REQUESTED]: {
    kind: 'terminal',
    note: 'UI card opened — wait for human; no auto graph',
  },
  [EVENT_TYPES.APPROVAL_DECIDED]: {
    kind: 'resume',
    note: 'Human decided — resume parked thread if thread_id present',
  },
  [EVENT_TYPES.AGENT_RUN_FAILED]: {
    kind: 'fail',
    note: 'Ops — persist to failed_workflows for replay',
  },
  [EVENT_TYPES.ASTRA_REQUIREMENT_RECEIVED]: {
    kind: 'graph',
    note: 'ASTRA channel intake — routed via graph_event_bindings (DB)',
  },
  [EVENT_TYPES.ASTRA_EMAIL_RECEIVED]: {
    kind: 'graph',
    note: 'Email JD — routed via graph_event_bindings (DB)',
  },
  [EVENT_TYPES.ASTRA_JOBBOARD_FETCH_REQUESTED]: {
    kind: 'graph',
    note: 'Job-board fetch — routed via graph_event_bindings (DB)',
  },
  [EVENT_TYPES.ASTRA_REQUIREMENT_SCORED]: {
    kind: 'terminal',
    note: 'ASTRA quality score — audit / same-graph handoff',
  },
  [EVENT_TYPES.ASTRA_REQUIREMENT_NORMALIZED]: {
    kind: 'terminal',
    note: 'ASTRA normalize outcome — audit / same-graph handoff',
  },
  [EVENT_TYPES.ASTRA_REQUIREMENT_REJECTED]: {
    kind: 'terminal',
    note: 'ASTRA gate rejected — UI / audit only',
  },
  [EVENT_TYPES.ORBIT_LIFECYCLE_TRANSITION_REQUESTED]: {
    kind: 'graph',
    note: 'ORBIT lifecycle — routed via graph_event_bindings (DB)',
  },
  [EVENT_TYPES.ORBIT_PLACEMENT_CONFIRM_REQUESTED]: {
    kind: 'graph',
    note: 'ORBIT placement — routed via graph_event_bindings (DB)',
  },
  [EVENT_TYPES.ORBIT_REVENUE_ARRANGE_REQUESTED]: {
    kind: 'graph',
    note: 'ORBIT revenue — routed via graph_event_bindings (DB)',
  },
  [EVENT_TYPES.ORBIT_ACTIVITY_NOTE_REQUESTED]: {
    kind: 'graph',
    note: 'ORBIT activity note — routed via graph_event_bindings (DB)',
  },
  [EVENT_TYPES.ORBIT_LIFECYCLE_TRANSITIONED]: {
    kind: 'terminal',
    note: 'ORBIT lifecycle outcome — audit / same-graph handoff',
  },
  [EVENT_TYPES.ORBIT_PLACEMENT_CONFIRMED]: {
    kind: 'terminal',
    note: 'ORBIT placement outcome — audit only',
  },
  [EVENT_TYPES.ORBIT_REVENUE_ARRANGED]: {
    kind: 'terminal',
    note: 'ORBIT revenue outcome — audit only',
  },
  [EVENT_TYPES.ORBIT_ACTIVITY_NOTED]: {
    kind: 'terminal',
    note: 'ORBIT activity outcome — audit only',
  },
  [EVENT_TYPES.ORBIT_BENCH_HOLD]: {
    kind: 'terminal',
    note: 'ORBIT hold/ignore — UI / audit only',
  },
  // Literals so a stale @tekisho/domain without ORBIT_* cannot collapse
  // computed keys to "undefined" and fall through to Unknown event.
  'orbit.lifecycle.transition_requested': {
    kind: 'graph',
    note: 'ORBIT lifecycle — routed via graph_event_bindings (DB)',
  },
  'orbit.placement.confirm_requested': {
    kind: 'graph',
    note: 'ORBIT placement — routed via graph_event_bindings (DB)',
  },
  'orbit.revenue.arrange_requested': {
    kind: 'graph',
    note: 'ORBIT revenue — routed via graph_event_bindings (DB)',
  },
  'orbit.activity.note_requested': {
    kind: 'graph',
    note: 'ORBIT activity note — routed via graph_event_bindings (DB)',
  },
  'orbit.lifecycle.transitioned': {
    kind: 'terminal',
    note: 'ORBIT lifecycle outcome — audit / same-graph handoff',
  },
  'orbit.placement.confirmed': {
    kind: 'terminal',
    note: 'ORBIT placement outcome — audit only',
  },
  'orbit.revenue.arranged': {
    kind: 'terminal',
    note: 'ORBIT revenue outcome — audit only',
  },
  'orbit.activity.noted': {
    kind: 'terminal',
    note: 'ORBIT activity outcome — audit only',
  },
  'orbit.bench.hold': {
    kind: 'terminal',
    note: 'ORBIT hold/ignore — UI / audit only',
  },
};

export function planForEvent(eventType: string): PlatformEventPlan {
  // The catalogue first — it is the thing an operator can change without a
  // release. The map below is the floor for a worker that has not loaded it,
  // or cannot reach the database. See handling-cache.ts.
  return (
    handlingFromCatalogue(eventType) ??
    PLATFORM_EVENT_PLAN[eventType] ?? {
      kind: 'terminal',
      note: 'Unknown event — ack as terminal',
    }
  );
}

/** Authored Syntra agent graph_key (admin Activate / go-live). */
export const SYNTRA_AUTHORED_GRAPH_KEY = 'syntra.authored';

/** Seed JD workflow (also seeded into graph_event_bindings). */
export const SYNTRA_JD_SEED_GRAPH_KEY = 'syntra.jd.workflow';

/**
 * @deprecated Ingress must use graph_event_bindings. Kept empty so accidental
 * use of SimpleRunbookResolver does not silently restore hardcoded routing.
 */
export const EVENT_TO_GRAPH: Record<string, string> = {};

/**
 * Module queues known to workers (createQueue / work). Not an event→graph map.
 */
export const MODULE_QUEUES = [
  'module.syntra.jd',
  'module.design.resume',
  'module.design.duplicate',
  'module.syntra.match',
  'module.orbit.bench',
] as const;

/** @deprecated Prefer module_queue on graph_event_bindings */
export const EVENT_TO_MODULE_QUEUE: Record<string, string> = {};

/** @deprecated Prefer module_queue on graph_event_bindings */
export const GRAPH_TO_MODULE_QUEUE: Record<string, string> = {
  'syntra.jd.workflow': 'module.syntra.jd',
  'syntra.authored': 'module.syntra.jd',
  'astra.requirement.workflow': 'module.syntra.jd',
  'astra.requirement.normalized.workflow': 'module.syntra.jd',
  'astra.email.intake.workflow': 'module.syntra.jd',
  'astra.jobboard.fetch.workflow': 'module.syntra.jd',
  'orbit.lifecycle.workflow': 'module.orbit.bench',
  'orbit.placement.workflow': 'module.orbit.bench',
  'orbit.revenue.workflow': 'module.orbit.bench',
  'orbit.activity.workflow': 'module.orbit.bench',
  'resume.intake': 'module.design.resume',
  'duplicate.review': 'module.design.duplicate',
  'syntra.match.workflow': 'module.syntra.match',
};

export const INGRESS_QUEUE = 'orchestration.ingress';
export const DISPATCH_QUEUE = 'orchestration.dispatch';
export const RESUME_THREAD_QUEUE = 'orchestration.resume-thread';

export const MODULE_SEND_OPTIONS = {
  retryLimit: 5,
  retryBackoff: true,
  retryDelay: 2,
} as const;
