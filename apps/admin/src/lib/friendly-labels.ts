/**
 * Plain-language labels for BenchSales admins (avoid raw tool keys in UI).
 */
import { getToolCatalog } from "@tekisho/authoring/src/tool-registry.js";
import { listTriggerEvents } from "@tekisho/authoring/src/trigger-events.js";

const TOOL_PLAIN: Record<string, { title: string; blurb: string }> = {
  "syntra.continuous.match": {
    title: "Match JD against bench",
    blurb: "After a job is parsed, find bench candidates who may fit",
  },
  "syntra.duplicate.detect": {
    title: "Check for duplicate candidate",
    blurb: "Flags likely duplicate profiles for review",
  },
  "syntra.bench.alert": {
    title: "Alert matching requirements",
    blurb: "Notifies live jobs that this candidate may match",
  },
  "syntra.shortlist.notify": {
    title: "Update shortlist UI",
    blurb: "Pushes match results so recruiters see the shortlist",
  },
  "syntra.duplicate.merge": {
    title: "Merge or keep duplicates",
    blurb: "Applies the human decision on duplicate candidates",
  },
  "syntra.run.retry": {
    title: "Retry failed agent run",
    blurb: "Asks Syntra to replay a run that exhausted retries",
  },
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
    title: "Pick what happens next",
    blurb: "Uses the quality score to continue automatically, ask a person, or stop",
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

export function isHumanTool(impl: string): boolean {
  return impl === "human.gate";
}

export function isOrchTool(impl: string): boolean {
  return impl.startsWith("orch.");
}

/** Platform family badge for workflow step lists. */
export function friendlyToolFamily(impl: string): "ASTRA" | "SYNTRA" | "Person" | "Routing" | "Other" {
  if (isAstraTool(impl)) return "ASTRA";
  if (isSyntraTool(impl)) return "SYNTRA";
  if (isHumanTool(impl)) return "Person";
  if (isOrchTool(impl)) return "Routing";
  return "Other";
}

/** Turn raw run errors into plain English for admins. */
export function friendlyFailureMessage(error: unknown): string | null {
  if (error == null) return null;
  let raw = "";
  if (typeof error === "string") {
    raw = error.trim();
  } else if (typeof error === "object") {
    const e = error as Record<string, unknown>;
    const msg = e.message ?? e.error ?? e.detail ?? e.reason ?? e.code ?? null;
    if (typeof msg === "string" && msg.trim()) raw = msg.trim();
    else {
      try {
        raw = JSON.stringify(error);
      } catch {
        return "The run failed for an unknown reason.";
      }
    }
  } else {
    raw = String(error);
  }
  if (!raw) return null;

  const lower = raw.toLowerCase();

  if (lower.includes("401") && lower.includes("user not found")) {
    return "SYNTRA could not verify the service account — check that SYNTRA is running and the orchestrator credentials in .env are correct.";
  }
  if (lower.includes("timeout") && lower.includes("connect")) {
    return "Could not reach SYNTRA in time — the matching service may be down or unreachable on the network.";
  }
  if (lower.includes("500") && lower.includes("syntra")) {
    return "SYNTRA returned an internal error while processing the job. Check SYNTRA logs for details.";
  }
  if (lower.includes("syntra") && lower.includes("not connected")) {
    return "SYNTRA is not connected — connect the Trail-syntra integration before running matching steps.";
  }
  if (lower.includes("[transient]") && lower.includes("syntra")) {
    return "A temporary SYNTRA error occurred while processing the job. You can retry the run once SYNTRA is healthy.";
  }
  if (lower.includes("matchthreshold") || lower.includes("continuous.match")) {
    return "The match score cutoff could not be applied — check that the matching step has Min score set in the workflow editor.";
  }

  // Strip technical prefixes like [transient] tool.key:
  const cleaned = raw
    .replace(/^\[transient\]\s*/i, "")
    .replace(/^[^:]+:\s*/, "")
    .replace(/\s*\{.*"error"\s*:\s*"([^"]+)".*\}\s*$/, " — $1")
    .trim();

  if (cleaned.length > 220) return `${cleaned.slice(0, 217)}…`;
  return cleaned || "The run failed for an unknown reason.";
}

/** Plain-English explanation for LLM “unsupported” gaps (not “tool missing”). */
export function friendlyUnsupportedGap(gap: string): string {
  const g = gap.toLowerCase();
  if (g.includes("matchthreshold") && g.includes("continuous.match")) {
    return "Match score cutoff — set Min score on the “Match JD against bench” or “Score job × resume match” step when editing the workflow.";
  }
  if (g.includes("matchthreshold") || g.includes("match score")) {
    return "Match score cutoff — set this on the “Score job × resume match” step (Min score field when editing), not on bench-wide matching.";
  }
  if (g.includes("visa") || g.includes("location") || g.includes("filter")) {
    return `${gap} — some filters only apply to the “Score job × resume match” step.`;
  }
  return `${gap} — this part of your request could not be added automatically to the generated workflow.`;
}

export function friendlyUnsupportedSummary(gaps: string[]): string {
  if (gaps.length === 0) return "";
  if (gaps.length === 1) return friendlyUnsupportedGap(gaps[0]!);
  return `${gaps.length} parts of your request could not be added automatically. See details below.`;
}

/** Plain-language “what this step needs” from the tool catalog. */
export function friendlyToolNeeds(impl: string): string {
  const tool = getToolCatalog().find((t) => t.key === impl);
  if (!tool) return "Information from the previous step in the workflow.";
  const parts = Object.entries(tool.input).map(([k, v]) => {
    const plain = v.replace(/\s*\(.*?\)\s*/g, "").trim();
    return plain || k;
  });
  return parts.length > 0
    ? parts.join("; ")
    : "Information from the previous step in the workflow.";
}

/** Plain-language “what this step produces” from the tool catalog. */
export function friendlyToolProduces(impl: string): string {
  const blurb = TOOL_PLAIN[impl]?.blurb;
  if (blurb) return blurb;
  const tool = getToolCatalog().find((t) => t.key === impl);
  if (!tool) return "Moves the workflow forward to the next step.";
  return friendlyEventLabel(tool.output.event);
}

export function friendlyTriggerBlurb(eventType: string | null | undefined): string {
  if (!eventType?.trim()) {
    return "Choose when this workflow should start in Policy — for example when a job or resume arrives.";
  }
  const label = friendlyEventLabel(eventType.trim());
  return `When “${label}” happens, this workflow runs automatically from the first step below.`;
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
