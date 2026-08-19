import type { BuilderOverviewAgent } from "../api";

const FLOW_ORDER = [
  "syntra.resume.received",
  "syntra.jd.received",
  "syntra.match.requested",
  "syntra.duplicate.review_required",
];

/**
 * Build a single readable document from all agents (admin-facing overview).
 */
export function buildAdminPlatformNarrative(
  agents: BuilderOverviewAgent[],
): string {
  if (agents.length === 0) {
    return "No agents yet. Create an agent from the sidebar to get started.";
  }

  const ordered = [...agents].sort((a, b) => {
    const ai = FLOW_ORDER.indexOf(a.triggerEventType ?? "");
    const bi = FLOW_ORDER.indexOf(b.triggerEventType ?? "");
    const ao = ai === -1 ? 99 : ai;
    const bo = bi === -1 ? 99 : bi;
    return ao - bo || a.name.localeCompare(b.name);
  });

  const lines: string[] = [
    "OVERALL HIRING POLICY — ALL AGENTS",
    "",
    "Read-only summary. To change one agent, select it below and edit its Policy box.",
    "",
  ];

  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i];
    const ingress = a.binding
      ? `Live — handles ${friendlyTriggerLabel(a.triggerEventType ?? a.binding.eventType)}`
      : a.policyStatus === "active"
        ? "Saved as live but not connected to uploads yet"
        : a.workflowEmpty
          ? "No workflow yet"
          : "Workflow saved — not live yet";

    lines.push(`${i + 1}. ${a.name}`);
    lines.push(`   Status: ${ingress}`);
    if (a.triggerEventType) {
      lines.push(`   Starts when: ${friendlyTriggerLabel(a.triggerEventType)}`);
    }
    lines.push("");
    lines.push("   Policy:");
    lines.push(`   ${a.policyText || "(empty — add policy text for this agent)"}`);
    lines.push("");
    if (!a.workflowEmpty && a.workflowSteps.length > 0) {
      lines.push("   Workflow steps:");
      for (const s of a.workflowSteps) {
        lines.push(`     ${s.order}. ${s.label}${s.detail ? ` — ${s.detail}` : ""}`);
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  lines.push(
    "Platform tools available to workflows: process job description, process resume, score matches, pause for human review.",
  );

  return lines.join("\n");
}

function friendlyTriggerLabel(eventType: string): string {
  const map: Record<string, string> = {
    "syntra.jd.received": "When a job description arrives",
    "syntra.resume.received": "When a resume arrives",
    "syntra.match.requested": "When a match is requested",
    "syntra.duplicate.review_required": "When duplicate review is needed",
  };
  return map[eventType] ?? eventType;
}

/** Shared plain-language labels for trigger events (sidebar, cards, policy editor). */
export function friendlyEventLabel(eventType: string): string {
  return friendlyTriggerLabel(eventType);
}

/**
 * Build a single readable document from all agents in the DB (engineer view).
 */
export function buildPlatformNarrative(
  agents: BuilderOverviewAgent[],
): string {
  if (agents.length === 0) {
    return "No agents yet. Click + Create Agent in the sidebar to add one.";
  }

  const ordered = [...agents].sort((a, b) => {
    const ai = FLOW_ORDER.indexOf(a.triggerEventType ?? "");
    const bi = FLOW_ORDER.indexOf(b.triggerEventType ?? "");
    const ao = ai === -1 ? 99 : ai;
    const bo = bi === -1 ? 99 : bi;
    return ao - bo || a.name.localeCompare(b.name);
  });

  const lines: string[] = [
    "PLATFORM HIRING FLOW (read from database)",
    "========================================",
    "",
    "How ingress works:",
    "  1. A real event arrives (e.g. syntra.jd.received).",
    "  2. Router looks up graph_event_bindings for that event_type.",
    "  3. The active graph from graph_definitions runs (nodes = tools, edges = order).",
    "",
    "AGENTS IN THIS PLATFORM:",
    "",
  ];

  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i];
    const next = ordered[i + 1];
    lines.push(`[${i + 1}] ${a.name}`);
    lines.push(`    Agent key: ${a.agentKey}`);
    lines.push(`    Status: ${a.policyStatus ?? "new"} (policy v${a.policyVersion ?? "—"})`);
    if (a.triggerEventType) {
      lines.push(`    Starts when: ${a.triggerEventType}`);
    }
    if (a.binding) {
      lines.push(
        `    Live route: ${a.binding.eventType} → ${a.binding.graphKey}@v${a.binding.version ?? "?"} (${a.binding.source})`,
      );
    } else {
      lines.push("    Live route: not connected yet (use Make live to link this workflow to uploads)");
    }
    lines.push("");
    lines.push("    POLICY (agent_policies.policy.prompt):");
    lines.push(`    ${a.policyText || "(empty — add policy text for this agent)"}`);
    lines.push("");
    if (a.workflowEmpty) {
      lines.push("    GRAPH: not generated yet (agent_versions)");
    } else {
      lines.push(
        `    GRAPH (${a.graphKey ?? "authored"} v${a.graphVersion ?? "?"} in agent_versions → graph_definitions on go-live):`,
      );
      for (const s of a.workflowSteps) {
        lines.push(
          `      Step ${s.order}: ${s.label} [${s.impl}]${s.detail ? ` — ${s.detail}` : ""}`,
        );
      }
    }
    lines.push("");
    if (next) {
      lines.push(
        `    ↓ After this agent's tools finish, the platform may emit events that trigger: ${next.name} (${next.triggerEventType ?? "next agent"})`,
      );
    } else {
      lines.push("    ↓ End of configured agent chain for this view.");
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  lines.push("TOOL CATALOG (backend — not edited in this box):");
  lines.push("  syntra.jd.process → parse JD");
  lines.push("  syntra.resume.process → parse resume / profile");
  lines.push("  syntra.match.process → score job × resume match");
  lines.push("  human.gate → pause for human review (duplicate, approval)");
  lines.push("");
  lines.push(
    "To change one agent: select it in the sidebar and edit its Policy box below.",
  );

  return lines.join("\n");
}

export function buildFlowChain(agents: BuilderOverviewAgent[]): Array<{
  fromAgent: string;
  event: string;
  toAgent: string;
  graphKey: string;
  live: boolean;
  conflict?: string;
}> {
  const chain: Array<{
    fromAgent: string;
    event: string;
    toAgent: string;
    graphKey: string;
    live: boolean;
    conflict?: string;
  }> = [];

  const byEvent = new Map<string, BuilderOverviewAgent[]>();
  for (const a of agents) {
    if (!a.triggerEventType) continue;
    const list = byEvent.get(a.triggerEventType) ?? [];
    list.push(a);
    byEvent.set(a.triggerEventType, list);
  }

  chain.push({
    fromAgent: "Ingress / event bus",
    event: "real platform events",
    toAgent: "see bindings below",
    graphKey: "graph_event_bindings",
    live: agents.some((a) => a.binding),
  });

  for (const [eventType, list] of byEvent) {
    const liveAgents = list.filter((a) => a.binding);
    const primary = liveAgents[0] ?? list[0];
    if (!primary) continue;
    let conflict: string | undefined;
    if (liveAgents.length > 1) {
      conflict = `Multiple live bindings for ${eventType} — only one can run at runtime`;
    } else if (liveAgents.length === 1 && list.length > 1) {
      conflict = `${list.length - 1} other agent(s) use this trigger but are not live yet`;
    }
    chain.push({
      fromAgent: "Ingress / event bus",
      event: eventType,
      toAgent: primary.name,
      graphKey: primary.binding?.graphKey ?? `${primary.agentKey}.authored`,
      live: Boolean(primary.binding),
      conflict,
    });
  }

  return chain;
}

export function friendlyAgentTitle(raw: string): string {
  let t = raw.trim();
  if (!t) return "Agent";
  t = t.replace(/^SYNTRA\s*[—–-]\s*/i, "");
  t = t.replace(/^matching-agent$/i, "Candidate matching");
  t = t.replace(/^intake-agent$/i, "Intake");
  t = t.replace(/^astra$/i, "ASTRA");
  t = t.replace(/^orbit$/i, "ORBIT");
  t = t.replace(/^helix$/i, "HELIX");
  t = t.replace(/^tempo$/i, "TEMPO");
  t = t.replace(/^prism$/i, "PRISM");
  t = t.replace(/^tayln$/i, "TAYLN");
  t = t.replace(/-agent$/i, "");
  return t.trim() || "Agent";
}
