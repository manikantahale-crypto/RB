/**
 * Tool registry keys a policy may reference (design §2 / §4).
 * Behaviour lives in code; policies only select keys.
 */
export const TOOL_REGISTRY = {
  extract_document_text: { description: "Extract text from a document" },
  parse_jd: { description: "Parse a job description" },
  normalize_skills: { description: "Normalize skill names" },
  generate_embedding: { description: "Generate an embedding vector" },
  upsert_embedding: { description: "Upsert embedding into store" },
  search_bench_hybrid: { description: "Hybrid bench search" },
  deduplicate_candidates: { description: "Deduplicate candidates" },
  calculate_match_score: { description: "Score a match" },
  generate_match_explanation: { description: "Explain a match score" },
  persist_match_results: { description: "Persist match results" },
  record_activity: { description: "Record activity spine event" },
  request_approval: { description: "Request human approval" },
  parse_resume: { description: "Parse a resume" },
  draft_communication: { description: "Draft external communication" },
  hard_filter: { description: "Apply hard filters before match (authored graphs)" },
} as const;

export type ToolKey = keyof typeof TOOL_REGISTRY;

export function isRegisteredTool(key: string): key is ToolKey {
  return key in TOOL_REGISTRY;
}

export function listToolKeys(): ToolKey[] {
  return Object.keys(TOOL_REGISTRY) as ToolKey[];
}
