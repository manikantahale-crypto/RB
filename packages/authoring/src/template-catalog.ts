import type { AgentTemplate } from "./agent-template.js";
import { AgentTemplateSchema } from "./agent-template.js";

/** In-repo seed catalog (mirrors R__seed_agent_templates.sql). */
export const TEMPLATE_SEED_CATALOG: Array<{
  id: string;
  agentKey: string;
  agentId: string;
  displayName: string;
  version: number;
  template: AgentTemplate;
}> = [
  {
    id: "01900000-0000-7000-8000-000000000601",
    agentKey: "syntra",
    agentId: "01900000-0000-7000-8000-000000000501",
    displayName: "SYNTRA — AI Candidate Matching",
    version: 1,
    template: AgentTemplateSchema.parse({
      agentKey: "syntra",
      displayName: "SYNTRA — AI Candidate Matching",
      policyExt: "SyntraPolicyExt",
      nodes: [
        { id: "parse", impl: "parse_jd" },
        { id: "normalize", impl: "normalize_skills" },
        { id: "embed", impl: "generate_embedding" },
        { id: "search", impl: "search_bench_hybrid" },
        { id: "dedupe", impl: "deduplicate_candidates" },
        {
          id: "match",
          impl: "calculate_match_score",
          configFrom: ["matchThreshold", "rerank"],
        },
        { id: "explain", impl: "generate_match_explanation" },
        { id: "persist", impl: "persist_match_results" },
      ],
      wiring: [
        ["__start__", "parse"],
        ["parse", "normalize"],
        ["normalize", "embed"],
        ["embed", "search"],
        ["search", "dedupe"],
        ["dedupe", "match"],
        ["match", "explain"],
        ["explain", "persist"],
        ["persist", "__end__"],
      ],
      conditionalOn: {
        hardFilters: "insert filter node before match when non-empty",
      },
    }),
  },
  {
    id: "01900000-0000-7000-8000-000000000602",
    agentKey: "intake",
    agentId: "01900000-0000-7000-8000-000000000502",
    displayName: "Intake — Channel Arrival Interpreter",
    version: 1,
    template: AgentTemplateSchema.parse({
      agentKey: "intake",
      displayName: "Intake — Channel Arrival Interpreter",
      policyExt: "IntakePolicyExt",
      nodes: [
        { id: "extract", impl: "extract_document_text" },
        { id: "parse", impl: "parse_jd" },
        { id: "resume", impl: "parse_resume" },
        { id: "record", impl: "record_activity" },
      ],
      wiring: [
        ["__start__", "extract"],
        ["extract", "parse"],
        ["parse", "record"],
        ["record", "__end__"],
      ],
      conditionalOn: {},
    }),
  },
  {
    id: "01900000-0000-7000-8000-000000000603",
    agentKey: "copilot",
    agentId: "01900000-0000-7000-8000-000000000503",
    displayName: "Copilot — Recruiter Assistant",
    version: 1,
    template: AgentTemplateSchema.parse({
      agentKey: "copilot",
      displayName: "Copilot — Recruiter Assistant",
      policyExt: "CopilotPolicyExt",
      nodes: [
        { id: "search", impl: "search_bench_hybrid" },
        { id: "score", impl: "calculate_match_score" },
        { id: "draft", impl: "draft_communication" },
        { id: "record", impl: "record_activity" },
      ],
      wiring: [
        ["__start__", "search"],
        ["search", "score"],
        ["score", "draft"],
        ["draft", "record"],
        ["record", "__end__"],
      ],
      conditionalOn: {},
    }),
  },
];
