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
      // No dedicated intake runtime nodes yet — reuse Syntra process nodes.
      nodes: [
        { id: "jd", impl: "syntra.jd.process" },
        { id: "resume", impl: "syntra.resume.process" },
      ],
      wiring: [
        ["__start__", "jd"],
        ["jd", "resume"],
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
