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
    description: "Fired when Syntra accepts a new JD upload.",
    moduleQueue: "module.syntra.jd",
    defaultGraphKey: "syntra.jd.workflow",
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
  {
    eventType: "syntra.jd.parsed",
    label: "Job description parsed",
    description: "Fired when structured JD requirements are persisted.",
    moduleQueue: "module.syntra.match",
    defaultGraphKey: "syntra.continuous.match",
  },
  {
    eventType: "syntra.profile.prepared",
    label: "Profile prepared",
    description: "Fired when resume parse, skills, and embedding are done.",
    moduleQueue: "module.design.duplicate",
    defaultGraphKey: "syntra.duplicate.detect",
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
