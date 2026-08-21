/**
 * Enriched tool catalog for the LLM graph generator + Admin Builder.
 * Keys must match runtime `nodeRegistry` (ASTRA + Syntra process + follow-ups).
 */

export type ToolCatalogEntry = {
  key: string;
  description: string;
  input: Record<string, string>;
  output: {
    event: string;
    shape: string;
  };
  triggeredBy: string;
};

export const TOOL_CATALOG: readonly ToolCatalogEntry[] = [
  {
    key: "syntra.jd.process",
    description:
      "Process a job description: parse it and prepare structured requirements via Syntra.",
    input: { jobId: "string (required) — the job to process" },
    output: { event: "syntra.jd.parsed", shape: "{ jobId, status, syntra }" },
    triggeredBy: "syntra.jd.received",
  },
  {
    key: "syntra.resume.process",
    description:
      "Process a resume: parse, normalize skills, and prepare a profile via Syntra.",
    input: {
      resumeId: "string (required)",
      candidateId: "string (optional)",
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
      "Score a job × resume match via Syntra. Config: hardFilters, matchThreshold, rerank.",
    input: {
      jobId: "string (required)",
      resumeId: "string (required)",
      candidateId: "string (optional)",
    },
    output: {
      event: "syntra.match.completed",
      shape: "{ jobId, resumeId, skillMatchScore, status }",
    },
    triggeredBy: "syntra.match.requested",
  },
  {
    key: "syntra.continuous.match",
    description:
      "After a JD is parsed, match that requirement against the bench via Syntra. " +
      "Config: matchThreshold, hardFilters, rerank (same as syntra.match.process).",
    input: {
      jobId: "string (required) — the parsed job / requirement",
      matchThreshold: "number (config, optional) — minimum score 0–100",
      hardFilters: "string[] (config, optional)",
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
    key: "astra.requirement.intake",
    description:
      "Ingest an email-shaped JD via Syntra ASTRA. Emits astra.requirement.received.",
    input: {
      subject: "string — email subject / title",
      body: "string (required) — email body / raw JD text",
      from: "string (optional) — sender",
    },
    output: {
      event: "astra.requirement.received",
      shape: "{ jobId, requirement_id, channel_type: EMAIL }",
    },
    triggeredBy: "astra.email.received",
  },
  {
    key: "astra.requirement.ingest",
    description:
      "Source-agnostic JD insert (no email shaping). Emits astra.requirement.received.",
    input: {
      title: "string (optional)",
      raw_text: "string (required)",
      channel_type: "string (optional) — API / CHANNEL",
    },
    output: {
      event: "astra.requirement.received",
      shape: "{ jobId, requirement_id, channel_type }",
    },
    triggeredBy: "astra.requirement.ingest_requested",
  },
  {
    key: "astra.jobboard.fetch",
    description:
      "Fetch / ingest job-board listings into ASTRA. Emits astra.requirement.received per job.",
    input: {
      source: "string — board name or manual",
      keyword: "string — search keyword",
      location: "string (optional)",
    },
    output: {
      event: "astra.requirement.received",
      shape: "{ jobId, channel_type: JOB_BOARD }",
    },
    triggeredBy: "astra.jobboard.fetch_requested",
  },
  {
    key: "astra.requirement.quality",
    description:
      "Cheap JD quality score (no full LLM). Sets is_actionable + confidence_score for branching.",
    input: {
      jobId: "string (optional if raw_text present)",
      raw_text: "string (optional)",
    },
    output: {
      event: "astra.requirement.scored",
      shape: "{ is_actionable, confidence_score, validation_details }",
    },
    triggeredBy: "astra.requirement.received",
  },
  {
    key: "astra.requirement.normalize",
    description:
      "Full ASTRA enrich via Syntra (skills, role, quality). Emits astra.requirement.normalized.",
    input: {
      jobId: "string (required)",
      raw_text: "string (optional)",
    },
    output: {
      event: "astra.requirement.normalized",
      shape: "{ jobId, is_actionable, confidence_score, parser_version }",
    },
    triggeredBy: "astra.requirement.received",
  },
  {
    key: "astra.route.decision",
    description:
      "Route gate: actionable → syntra.jd.normalized (SYNTRA bridge); else astra.requirement.rejected.",
    input: {
      jobId: "string (required)",
      is_actionable: "boolean",
      confidence_score: "number",
      minConfidence: "number (config)",
    },
    output: {
      event: "syntra.jd.normalized",
      shape: "{ jobId, is_actionable, confidence_score } or rejected",
    },
    triggeredBy: "astra.requirement.normalized",
  },
  {
    key: "orch.branch.decision",
    description:
      "Conditional planner: sets branch_key pass | human_review | reject from confidence/actionable. " +
      "Wire graph.conditionalEdges from this node. Use before/with human.gate for human-in-the-loop.",
    input: {
      confidence_score: "number — from quality/normalize",
      is_actionable: "boolean",
      passMin: "number (config, default 0.6)",
      humanMin: "number (config, default 0.35)",
    },
    output: {
      event: "astra.requirement.rejected",
      shape: "state.branch_key; optional reject event when configured",
    },
    triggeredBy: "astra.requirement.scored",
  },
  {
    key: "human.gate",
    description:
      "Pause for human review (approval). Resume via orchestration.resume-thread. " +
      "Pair with orch.branch.decision (human_review → human.gate → route).",
    input: { reason: "string (optional)" },
    output: {
      event: "syntra.approval.requested",
      shape: "{ reason, gate, source_event_id }",
    },
    triggeredBy: "syntra.duplicate.review_required",
  },
] as const;

export const RUNTIME_RUNNABLE_IMPLS: readonly string[] = TOOL_CATALOG.map(
  (t) => t.key,
);

export const TOOL_REGISTRY: Record<string, { description: string }> =
  Object.fromEntries(
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

export function catalogRelatedEventTypes(): string[] {
  const set = new Set<string>();
  for (const t of TOOL_CATALOG) {
    set.add(t.triggeredBy);
    set.add(t.output.event);
  }
  return [...set];
}
