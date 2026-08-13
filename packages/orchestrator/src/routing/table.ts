import { EVENT_TYPES } from '@tekisho/domain';

/**
 * Day-1 platform events (event_schemas / platform-event.ts).
 *
 * kind:
 * - graph   → start a LangGraph workflow
 * - terminal → persisted + observed only (UI / audit); no graph
 * - resume  → continue a parked human.gate thread
 * - fail    → mirror into failed_workflows
 */
export type EventHandleKind = 'graph' | 'terminal' | 'resume' | 'fail';

export type PlatformEventPlan = {
  kind: EventHandleKind;
  /** Required when kind === 'graph' */
  graphKey?: string;
  moduleQueue?: string;
  note: string;
};

export const PLATFORM_EVENT_PLAN: Record<string, PlatformEventPlan> = {
  [EVENT_TYPES.JD_RECEIVED]: {
    kind: 'graph',
    graphKey: 'syntra.jd.workflow',
    moduleQueue: 'module.syntra.jd',
    note: 'Trigger — process JD via Syntra HTTP',
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
