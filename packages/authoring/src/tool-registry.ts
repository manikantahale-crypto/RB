/**
 * Enriched tool catalog for the LLM graph generator (llm-graph-generator-design §4.1).
 *
 * Keys must match runtime `nodeRegistry` (Syntra process + follow-up impls).
 * Teammate tools land here as catalog data only — no engine change (A6 / §9 #5).
 */

export type ToolCatalogEntry = {
  key: string;
  description: string;
  /** Human-readable required/optional inputs for the system prompt. */
  input: Record<string, string>;
  output: {
    event: string;
    shape: string;
  };
  triggeredBy: string;
};

/**
 * The LLM's entire tool universe today (design §3).
 * Sourced from packages/orchestrator/src/nodes/syntra.ts.
 */
export const TOOL_CATALOG: readonly ToolCatalogEntry[] = [
  {
    key: "syntra.jd.process",
    description:
      "Process a job description: parse it and prepare structured requirements via Syntra.",
    input: {
      jobId: "string (required) — the job to process",
    },
    output: {
      event: "syntra.jd.parsed",
      shape: "{ jobId, status, syntra }",
    },
    triggeredBy: "syntra.jd.received",
  },
  {
    key: "syntra.resume.process",
    description:
      "Process a resume: parse, normalize skills, and prepare a profile via Syntra.",
    input: {
      resumeId: "string (required) — the resume to process",
      candidateId: "string (optional) — provisional candidate id",
    },
    output: {
      event: "syntra.profile.prepared",
      shape: "{ resumeId, candidateId, status, syntra }",
    },
    triggeredBy: "syntra.resume.received",
  },
  {
    key: "syntra.match.process",
    description:
      "Score a job × resume match: via Syntra; persist results. " +
      "Put matching rules in node.config when the admin asks in English " +
      "(hardFilters, matchThreshold, rerank) — there is no separate filter tool.",
    input: {
      jobId: "string (required) — the job",
      resumeId: "string (required) — the resume",
      candidateId: "string (optional)",
    },
    output: {
      event: "syntra.match.completed",
      shape: "{ jobId, resumeId, candidateId, skillMatchScore, status, syntra }",
    },
    triggeredBy: "syntra.match.requested",
  },
  {
    key: "syntra.continuous.match",
    description:
      "After a JD is parsed, match that requirement against the bench via Syntra.",
    input: {
      jobId: "string (required) — the parsed job / requirement",
    },
    output: {
      event: "syntra.match.completed",
      shape: "{ jobId, requirement_id, match_job_id, result_count, status, syntra }",
    },
    triggeredBy: "syntra.jd.parsed",
  },
  {
    key: "syntra.duplicate.detect",
    description:
      "After a profile is prepared, check for a probable duplicate candidate via Syntra.",
    input: {
      candidateId: "string (required) — the prepared candidate",
    },
    output: {
      event: "syntra.duplicate.review_required",
      shape: "{ duplicate_review_id, candidate_a, candidate_b, signals }",
    },
    triggeredBy: "syntra.profile.prepared",
  },
  {
    key: "syntra.bench.alert",
    description:
      "After a profile is prepared, alert live requirements that this bench candidate may match.",
    input: {
      candidateId: "string (required) — the prepared candidate",
    },
    output: {
      event: "syntra.match.requested",
      shape: "{ candidateId, jobId, resumeId, status, syntra }",
    },
    triggeredBy: "syntra.profile.prepared",
  },
  {
    key: "syntra.shortlist.notify",
    description:
      "After match results are persisted, notify Syntra so the recruiter shortlist UI updates.",
    input: {
      jobId: "string (required) — the requirement that was matched",
    },
    output: {
      event: "syntra.match.completed",
      shape: "{ jobId, status }",
    },
    triggeredBy: "syntra.match.completed",
  },
  {
    key: "syntra.duplicate.merge",
    description:
      "After a human duplicate decision, merge or keep the two candidates in Syntra.",
    input: {
      approval_id: "string (required) — the decided approval item",
      decision: "string — APPROVED | REJECTED | MODIFIED | EXPIRED",
    },
    output: {
      event: "syntra.approval.decided",
      shape: "{ approval_id, decision, status }",
    },
    triggeredBy: "syntra.approval.decided",
  },
  {
    key: "syntra.run.retry",
    description:
      "After a run exhausts retries, ask Syntra to replay that agent run.",
    input: {
      agent_run_id: "string (required) — the failed run",
    },
    output: {
      event: "syntra.agent_run.failed",
      shape: "{ agent_run_id, status }",
    },
    triggeredBy: "syntra.agent_run.failed",
  },
  {
    key: "human.gate",
    description:
      "Pause the workflow for human review (duplicate check, approval gate). " +
      "Set config.reason (e.g. duplicate_review) on the node.",
    input: {
      reason: "string (optional) — why review is needed",
    },
    output: {
      event: "syntra.approval.requested",
      shape: "{ reason, gate, source_event_id }",
    },
    triggeredBy: "syntra.duplicate.review_required",
  },
] as const;

/**
 * Admin-authorable node impl keys that pass go-live (must exist in orchestrator nodeRegistry).
 * Single source — do not duplicate in go-live-gate.
 */
export const RUNTIME_RUNNABLE_IMPLS: readonly string[] = TOOL_CATALOG.map(
  (t) => t.key,
);

/** Registry map used by isRegisteredTool / Generate validation. */
export const TOOL_REGISTRY: Record<
  string,
  { description: string }
> = Object.fromEntries(
  TOOL_CATALOG.map((t) => [t.key, { description: t.description }]),
);

export type ToolKey = (typeof TOOL_CATALOG)[number]["key"];

export function isRegisteredTool(key: string): key is ToolKey {
  return key in TOOL_REGISTRY;
}

export function listToolKeys(): ToolKey[] {
  return TOOL_CATALOG.map((t) => t.key);
}

export function getToolCatalog(): readonly ToolCatalogEntry[] {
  return TOOL_CATALOG;
}

/** Event types the catalog tools emit or are triggered by (for event_schemas lookup). */
export function catalogRelatedEventTypes(): string[] {
  const set = new Set<string>();
  for (const t of TOOL_CATALOG) {
    set.add(t.triggeredBy);
    set.add(t.output.event);
  }
  return [...set];
}
