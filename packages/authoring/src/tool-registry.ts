/**
 * Enriched tool catalog for the LLM graph generator (llm-graph-generator-design §4.1).
 *
 * Keys must match runtime `nodeRegistry` production nodes.
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
] as const;

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
