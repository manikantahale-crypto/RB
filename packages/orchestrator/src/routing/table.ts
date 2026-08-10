import { EVENT_TYPES } from "@tekisho/domain";

/** event_type → graph_key (design §9.1 routing table, Syntra slice) */
export const EVENT_TO_GRAPH: Record<string, string> = {
  [EVENT_TYPES.JD_RECEIVED]: "syntra.jd.workflow",
  [EVENT_TYPES.RESUME_RECEIVED]: "syntra.resume.workflow",
  [EVENT_TYPES.MATCH_REQUESTED]: "syntra.match.workflow",
};

/** event_type → module queue (design §9 router → module workers) */
export const EVENT_TO_MODULE_QUEUE: Record<string, string> = {
  [EVENT_TYPES.JD_RECEIVED]: "module.syntra.jd",
  [EVENT_TYPES.RESUME_RECEIVED]: "module.syntra.resume",
  [EVENT_TYPES.MATCH_REQUESTED]: "module.syntra.match",
};

export const INGRESS_QUEUE = "orchestration.ingress";
export const DISPATCH_QUEUE = "orchestration.dispatch";

export const MODULE_QUEUES = [
  "module.syntra.jd",
  "module.syntra.resume",
  "module.syntra.match",
] as const;
