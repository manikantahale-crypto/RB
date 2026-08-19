/**
 * Plain-language labels for BenchSales admins (avoid raw tool keys in UI).
 */
import { getToolCatalog } from "@tekisho/authoring/src/tool-registry.js";
import { listTriggerEvents } from "@tekisho/authoring/src/trigger-events.js";

const TOOL_PLAIN: Record<string, { title: string; blurb: string }> = {
  "astra.requirement.intake": {
    title: "Receive email job description",
    blurb: "Pulls a JD from an email into the system",
  },
  "astra.requirement.ingest": {
    title: "Save job description",
    blurb: "Stores a JD from any source (API, paste, upload)",
  },
  "astra.jobboard.fetch": {
    title: "Fetch from job boards",
    blurb: "Imports listings from market job boards",
  },
  "astra.requirement.quality": {
    title: "Check JD quality",
    blurb: "Scores how complete the job description is",
  },
  "astra.requirement.normalize": {
    title: "Enrich & structure JD",
    blurb: "Extracts skills, role, and cleans the requirement",
  },
  "astra.route.decision": {
    title: "Send to matching (or stop)",
    blurb: "If good enough → SYNTRA matching; otherwise reject",
  },
  "orch.branch.decision": {
    title: "Decide next path",
    blurb: "Auto-process, ask a person, or reject based on score",
  },
  "human.gate": {
    title: "Ask a person to review",
    blurb: "Pauses until someone approves or rejects",
  },
  "syntra.jd.process": {
    title: "Process job for matching",
    blurb: "Prepares the JD inside SYNTRA for candidate matching",
  },
  "syntra.resume.process": {
    title: "Process resume",
    blurb: "Parses a resume into a candidate profile",
  },
  "syntra.match.process": {
    title: "Score job × resume match",
    blurb: "Compares a candidate against the job",
  },
};

const EVENT_PLAIN: Record<string, string> = {
  "syntra.jd.received": "A job description arrived",
  "syntra.jd.normalized": "ASTRA finished — ready for SYNTRA matching",
  "syntra.jd.parsed": "Job was processed in SYNTRA",
  "syntra.resume.received": "A resume arrived",
  "syntra.profile.prepared": "Candidate profile ready",
  "syntra.match.requested": "A match was requested",
  "syntra.match.completed": "Match scoring finished",
  "syntra.approval.requested": "Waiting for human approval",
  "syntra.approval.decided": "Human decided",
  "astra.requirement.received": "ASTRA ingested a requirement",
  "astra.requirement.scored": "ASTRA scored JD quality",
  "astra.requirement.normalized": "ASTRA enriched the JD",
  "astra.requirement.rejected": "ASTRA rejected the JD",
  "astra.email.received": "Email JD arrived",
  "astra.jobboard.fetch_requested": "Job-board fetch requested",
};

export function friendlyToolTitle(impl: string): string {
  if (TOOL_PLAIN[impl]) return TOOL_PLAIN[impl].title;
  const tool = getToolCatalog().find((t) => t.key === impl);
  if (tool) return tool.description.split(":")[0]?.trim() || impl;
  return impl;
}

export function friendlyToolBlurb(impl: string): string {
  return TOOL_PLAIN[impl]?.blurb ?? "";
}

export function friendlyEventLabel(eventType: string): string {
  if (EVENT_PLAIN[eventType]) return EVENT_PLAIN[eventType];
  const hit = listTriggerEvents().find((t) => t.eventType === eventType);
  return hit?.label ?? eventType;
}

/** Short agent role for BenchSales narrative. */
export function friendlyAgentRole(agentKey: string): string {
  const k = agentKey.toLowerCase();
  if (k.includes("astra")) return "Intake gate (ASTRA)";
  if (k.includes("syntra") || k.includes("intake")) return "Matching (SYNTRA)";
  return agentKey;
}

export function isAstraTool(impl: string): boolean {
  return impl.startsWith("astra.");
}

export function isSyntraTool(impl: string): boolean {
  return impl.startsWith("syntra.");
}

/** Detect ASTRA → SYNTRA handoff in outbox event types. */
export function detectHandoff(eventTypes: string[]): {
  astraWorked: boolean;
  calledSyntra: boolean;
  rejected: boolean;
  humanAsked: boolean;
} {
  const set = new Set(eventTypes);
  return {
    astraWorked:
      set.has("astra.requirement.scored") ||
      set.has("astra.requirement.normalized") ||
      set.has("astra.requirement.rejected"),
    calledSyntra: set.has("syntra.jd.normalized") || set.has("syntra.jd.parsed"),
    rejected: set.has("astra.requirement.rejected"),
    humanAsked: set.has("syntra.approval.requested"),
  };
}
