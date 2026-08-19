/**
 * Trigger events an admin may bind in the Builder (graph-kind only).
 * Used for catalog UI + Activate defaults — NOT for ingress resolution.
 * Ingress reads only `graph_event_bindings`.
 */

export type TriggerEventCatalogEntry = {
  eventType: string;
  label: string;
  description: string;
  /** Module queue stamped onto the binding at Activate / seed time. */
  moduleQueue: string;
  /** Suggested default graph_key for seed / new agents. */
  defaultGraphKey: string;
};

export const TRIGGER_EVENT_CATALOG: readonly TriggerEventCatalogEntry[] = [
  {
    eventType: "syntra.jd.received",
    label: "Job description received",
    description: "Fired when Syntra accepts a new JD upload (ASTRA front door).",
    moduleQueue: "module.syntra.jd",
    defaultGraphKey: "astra.requirement.workflow",
  },
  {
    eventType: "astra.requirement.received",
    label: "ASTRA requirement received",
    description: "After email/board/ingest — run quality → branch → normalize → route.",
    moduleQueue: "module.syntra.jd",
    defaultGraphKey: "astra.requirement.workflow",
  },
  {
    eventType: "astra.email.received",
    label: "Email JD received",
    description: "Trigger ASTRA email intake graph / channel tool.",
    moduleQueue: "module.syntra.jd",
    defaultGraphKey: "astra.email.intake.workflow",
  },
  {
    eventType: "astra.jobboard.fetch_requested",
    label: "Job-board fetch requested",
    description: "Trigger ASTRA job-board fetch then quality gate.",
    moduleQueue: "module.syntra.jd",
    defaultGraphKey: "astra.jobboard.fetch.workflow",
  },
  {
    eventType: "syntra.jd.normalized",
    label: "JD normalized (ASTRA → SYNTRA bridge)",
    description: "ASTRA route passed — run SYNTRA matching graph.",
    moduleQueue: "module.syntra.jd",
    defaultGraphKey: "syntra.authored",
  },
  {
    eventType: "syntra.resume.received",
    label: "Resume received",
    description: "Fired when Syntra accepts a new resume upload.",
    moduleQueue: "module.design.resume",
    defaultGraphKey: "resume.intake",
  },
  {
    eventType: "syntra.match.requested",
    label: "Match requested",
    description: "Fired when a job×resume pair should be scored.",
    moduleQueue: "module.syntra.match",
    defaultGraphKey: "syntra.match.workflow",
  },
  {
    eventType: "syntra.duplicate.review_required",
    label: "Duplicate review required",
    description: "Fired when a probable duplicate needs a human gate.",
    moduleQueue: "module.design.duplicate",
    defaultGraphKey: "duplicate.review",
  },
] as const;

export function isTriggerEventType(eventType: string): boolean {
  return TRIGGER_EVENT_CATALOG.some((e) => e.eventType === eventType);
}

export function getTriggerEvent(
  eventType: string,
): TriggerEventCatalogEntry | undefined {
  return TRIGGER_EVENT_CATALOG.find((e) => e.eventType === eventType);
}

export function listTriggerEvents(): readonly TriggerEventCatalogEntry[] {
  return TRIGGER_EVENT_CATALOG;
}
