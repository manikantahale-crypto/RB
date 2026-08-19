import type { AgentTemplate } from "./agent-template.js";

/** Default draft policy JSON for a seeded product agent (Builder). */
export function defaultDraftPolicyForTemplate(args: {
  agentId: string;
  agentKey: string;
  displayName: string;
  policyExt: string;
}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    agentId: args.agentId,
    agentKey: args.agentKey,
    prompt: defaultPromptForProduct(args.displayName, args.agentKey),
    allowedTools: ["syntra.jd.process", "syntra.resume.process", "syntra.match.process"],
    triggerEventType: "syntra.jd.received",
    retry: { max: 3, fallback: "human_review" },
    escalation: "none",
    guardrails: { piiRedact: false },
    matchThreshold: 60,
    hardFilters: [],
    rerank: true,
  };

  if (args.policyExt === "IntakePolicyExt") {
    base.allowedTools = ["syntra.resume.process"];
    base.triggerEventType = "syntra.resume.received";
    base.autoClassify = true;
    delete base.matchThreshold;
    delete base.hardFilters;
    delete base.rerank;
  }

  if (args.policyExt === "AstraPolicyExt") {
    base.allowedTools = [
      "astra.requirement.normalize",
      "astra.route.decision",
    ];
    base.triggerEventType = "syntra.jd.received";
    base.minConfidence = 0;
    base.prompt =
      "When a job description is received, normalize and score it with ASTRA. " +
      "If actionable, emit syntra.jd.normalized for SYNTRA matching; otherwise reject.";
    delete base.matchThreshold;
    delete base.hardFilters;
    delete base.rerank;
  }

  return base;
}

function defaultPromptForProduct(displayName: string, agentKey: string): string {
  const short = displayName.replace(/^[^—–-]+\s*[—–-]\s*/i, "").trim() || displayName;
  return (
    `${displayName}: describe what this agent should do when it runs. ` +
    `Include steps (process job descriptions, resumes, score matches, or ask for human review), ` +
    `match threshold, and any filters. Product agent (${agentKey}).`
  );
}

export function policyExtFromTemplate(template: AgentTemplate): string {
  return template.policyExt;
}
