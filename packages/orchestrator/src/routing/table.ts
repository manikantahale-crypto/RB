import { EVENT_TYPES } from '@tekisho/domain';

/**
 * Day-1 platform events (event_schemas / platform-event.ts).
 *
 * kind:
 * - graph   → start a LangGraph workflow
 * - terminal → persisted + observed only (UI / audit); no graph
 * - resume  → continue a parked human.gate thread
 * - fail    → mirror into failed_workflows
 *
 * Production go-live: JD traffic prefers the authored key (`syntra.authored`)
 * when an active definition exists; otherwise falls back to the seed workflow
 * so local smoke still works before admin Activate / Make this live.
 */
export type EventHandleKind = 'graph' | 'terminal' | 'resume' | 'fail';

export type PlatformEventPlan = {
  kind: EventHandleKind;
  /** Required when kind === 'graph' — preferred / primary graph_key */
  graphKey?: string;
  /**
   * When set, router uses `graphKey` only if that key has an active
   * graph_definitions row; otherwise routes to this seed key.
   */
  fallbackGraphKey?: string;
  moduleQueue?: string;
  note: string;
};

/** Authored Syntra agent graph_key (admin Activate / go-live). */
export const SYNTRA_AUTHORED_GRAPH_KEY = 'syntra.authored';

/** Seed JD workflow kept as fallback when authored is not active. */
export const SYNTRA_JD_SEED_GRAPH_KEY = 'syntra.jd.workflow';

export const PLATFORM_EVENT_PLAN: Record<string, PlatformEventPlan> = {
  [EVENT_TYPES.JD_RECEIVED]: {
    kind: 'graph',
    graphKey: SYNTRA_AUTHORED_GRAPH_KEY,
    fallbackGraphKey: SYNTRA_JD_SEED_GRAPH_KEY,
    moduleQueue: 'module.syntra.jd',
    note:
      'Trigger — prefer syntra.authored when active; else seed syntra.jd.workflow',
  },
  [EVENT_TYPES.JD_PARSED]: {
    kind: 'terminal',
    note: 'Outcome of JD process — UI / audit only',
  },
  [EVENT_TYPES.RESUME_RECEIVED]: {
    kind: 'graph',
    graphKey: 'resume.intake',
    moduleQueue: 'module.design.resume',
    note: 'Trigger — resume.intake via Syntra HTTP (syntra.resume.process)',
  },
  [EVENT_TYPES.PROFILE_PREPARED]: {
    kind: 'terminal',
    note: 'Outcome of resume/profile prep — UI / audit only',
  },
  [EVENT_TYPES.DUPLICATE_REVIEW_REQUIRED]: {
    kind: 'graph',
    graphKey: 'duplicate.review',
    moduleQueue: 'module.design.duplicate',
    note: 'Control — park at human.gate for merge decision',
  },
  [EVENT_TYPES.MATCH_REQUESTED]: {
    kind: 'graph',
    graphKey: 'syntra.match.workflow',
    moduleQueue: 'module.syntra.match',
    note: 'Trigger — score job×resume via Syntra HTTP',
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

/**
 * Pick the graph_key the router should pin.
 * Prefer `plan.graphKey` when active; else `fallbackGraphKey` when present.
 */
export async function resolveRoutableGraphKey(args: {
  eventType: string;
  organizationId?: string | null;
  hasActive: (
    graphKey: string,
    organizationId?: string | null,
  ) => Promise<boolean>;
}): Promise<string | null> {
  const plan = planForEvent(args.eventType);
  if (plan.kind !== 'graph' || !plan.graphKey) return null;

  if (!plan.fallbackGraphKey) return plan.graphKey;

  const preferredActive = await args.hasActive(
    plan.graphKey,
    args.organizationId,
  );
  if (preferredActive) return plan.graphKey;
  return plan.fallbackGraphKey;
}

/** event_type → graph_key for runbook / router */
export const EVENT_TO_GRAPH: Record<string, string> = Object.fromEntries(
  Object.entries(PLATFORM_EVENT_PLAN)
    .filter(([, p]) => p.kind === 'graph' && p.graphKey)
    .map(([t, p]) => [t, p.graphKey!]),
);

export const EVENT_TO_MODULE_QUEUE: Record<string, string> = Object.fromEntries(
  Object.entries(PLATFORM_EVENT_PLAN)
    .filter(([, p]) => p.kind === 'graph' && p.moduleQueue)
    .map(([t, p]) => [t, p.moduleQueue!]),
);

export const GRAPH_TO_MODULE_QUEUE: Record<string, string> = Object.fromEntries(
  Object.values(PLATFORM_EVENT_PLAN)
    .filter((p) => p.kind === 'graph' && p.graphKey && p.moduleQueue)
    .map((p) => [p.graphKey!, p.moduleQueue!]),
);

export const MODULE_QUEUES = [
  ...new Set(Object.values(EVENT_TO_MODULE_QUEUE)),
] as string[];

export const INGRESS_QUEUE = 'orchestration.ingress';
export const DISPATCH_QUEUE = 'orchestration.dispatch';
export const RESUME_THREAD_QUEUE = 'orchestration.resume-thread';

export const MODULE_SEND_OPTIONS = {
  retryLimit: 5,
  retryBackoff: true,
  retryDelay: 2,
} as const;
