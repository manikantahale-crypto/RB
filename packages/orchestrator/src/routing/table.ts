import { EVENT_TYPES } from '@tekisho/domain';

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
    kind: 'terminal',
    note: 'Outcome of JD process — UI / audit only',
  },
  [EVENT_TYPES.RESUME_RECEIVED]: {
    kind: 'graph',
    note: 'Trigger — routed via graph_event_bindings (DB)',
  },
  [EVENT_TYPES.PROFILE_PREPARED]: {
    kind: 'terminal',
    note: 'Outcome of resume/profile prep — UI / audit only',
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
};

export function planForEvent(eventType: string): PlatformEventPlan {
  return (
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
] as const;

/** @deprecated Prefer module_queue on graph_event_bindings */
export const EVENT_TO_MODULE_QUEUE: Record<string, string> = {};

/** @deprecated Prefer module_queue on graph_event_bindings */
export const GRAPH_TO_MODULE_QUEUE: Record<string, string> = {
  'syntra.jd.workflow': 'module.syntra.jd',
  'syntra.authored': 'module.syntra.jd',
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
