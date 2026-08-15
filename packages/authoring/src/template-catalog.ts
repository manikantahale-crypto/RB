import type { AgentTemplate } from "./agent-template.js";
import { AgentTemplateSchema } from "./agent-template.js";

/**
 * In-repo seed catalog (mirrors R__seed_agent_templates.sql).
 * Node `impl` keys must exist in TOOL_REGISTRY (= runtime nodeRegistry).
 */
export const TEMPLATE_SEED_CATALOG: Array<{
  id: string;
  agentKey: string;
  agentId: string;
  displayName: string;
  version: number;
  template: AgentTemplate;
  /** Runtime spine purpose when seeding agent_definitions (mock product agents). */
  purpose?: string;
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
        { id: "jd", impl: "syntra.jd.process" },
        { id: "resume", impl: "syntra.resume.process" },
        {
          id: "match",
          impl: "syntra.match.process",
          configFrom: ["matchThreshold", "rerank"],
        },
      ],
      wiring: [
        ["__start__", "jd"],
        ["jd", "resume"],
        ["resume", "match"],
        ["match", "__end__"],
      ],
      conditionalOn: {
        hardFilters: "stamp hardFilters onto match node config when non-empty",
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
      // Resume intake (matches seed resume.intake). Duplicate review → use LLM + human.gate.
      nodes: [{ id: "resume", impl: "syntra.resume.process" }],
      wiring: [
        ["__start__", "resume"],
        ["resume", "__end__"],
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
      // No dedicated copilot runtime nodes yet — reuse Syntra match node.
      nodes: [{ id: "match", impl: "syntra.match.process" }],
      wiring: [
        ["__start__", "match"],
        ["match", "__end__"],
      ],
      conditionalOn: {},
    }),
  },
];

const SYNTA_MATCH_NODES = [
  { id: "jd", impl: "syntra.jd.process" },
  { id: "resume", impl: "syntra.resume.process" },
  {
    id: "match",
    impl: "syntra.match.process",
    configFrom: ["matchThreshold", "rerank"],
  },
] as const;

const SYNTA_MATCH_WIRING = [
  ["__start__", "jd"],
  ["jd", "resume"],
  ["resume", "match"],
  ["match", "__end__"],
] as const;

/** Placeholder product agents (built like SYNTRA until dedicated runtime exists). */
const MOCK_PRODUCT_AGENTS: Array<{
  id: string;
  agentKey: string;
  agentId: string;
  displayName: string;
  purpose: string;
}> = [
  {
    id: "01900000-0000-7000-8000-000000000604",
    agentKey: "astra",
    agentId: "01900000-0000-7000-8000-000000000504",
    displayName: "ASTRA — Workforce Analytics",
    purpose: "Analyze bench talent, pipeline health, and hiring signals.",
  },
  {
    id: "01900000-0000-7000-8000-000000000605",
    agentKey: "orbit",
    agentId: "01900000-0000-7000-8000-000000000505",
    displayName: "ORBIT — Pipeline Orchestration",
    purpose: "Coordinate handoffs across intake, matching, and recruiter workflows.",
  },
  {
    id: "01900000-0000-7000-8000-000000000606",
    agentKey: "helix",
    agentId: "01900000-0000-7000-8000-000000000506",
    displayName: "HELIX — Candidate Journey",
    purpose: "Guide candidates through lifecycle steps from intake to placement.",
  },
  {
    id: "01900000-0000-7000-8000-000000000607",
    agentKey: "tempo",
    agentId: "01900000-0000-7000-8000-000000000507",
    displayName: "TEMPO — Scheduling & Follow-ups",
    purpose: "Schedule interviews, reminders, and timed follow-up actions.",
  },
  {
    id: "01900000-0000-7000-8000-000000000608",
    agentKey: "prism",
    agentId: "01900000-0000-7000-8000-000000000508",
    displayName: "PRISM — Insights & Reporting",
    purpose: "Summarize match quality, recruiter activity, and bench performance.",
  },
  {
    id: "01900000-0000-7000-8000-000000000609",
    agentKey: "tayln",
    agentId: "01900000-0000-7000-8000-000000000509",
    displayName: "TAYLN — Personalized Outreach",
    purpose: "Draft tailored outreach and messaging for candidates and clients.",
  },
];

for (const m of MOCK_PRODUCT_AGENTS) {
  TEMPLATE_SEED_CATALOG.push({
    id: m.id,
    agentKey: m.agentKey,
    agentId: m.agentId,
    displayName: m.displayName,
    purpose: m.purpose,
    version: 1,
    template: AgentTemplateSchema.parse({
      agentKey: m.agentKey,
      displayName: m.displayName,
      policyExt: "SyntraPolicyExt",
      nodes: [...SYNTA_MATCH_NODES],
      wiring: [...SYNTA_MATCH_WIRING],
      conditionalOn: {
        hardFilters: "stamp hardFilters onto match node config when non-empty",
      },
    }),
  });
}
