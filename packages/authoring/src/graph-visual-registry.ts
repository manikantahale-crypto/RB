import type { RouterKey } from "./validate-llm-graph.js";
import { isRegisteredTool, type ToolKey } from "./tool-registry.js";

/** Visual node types for the admin canvas — never chosen by the LLM. */
export type VisualNodeType = "start" | "ai_action" | "human_gate" | "end";

/** Optional run status for future live-run wiring — omit when absent. */
export type NodeRunStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "waiting";

export type OutcomeTone = "positive" | "negative";

export type NodeCopy = {
  /** Plain-language step name, e.g. "Duplicate detection". */
  title: string;
  /** "Automatic step" | "Needs a person" | "Start" | "End". */
  kicker: string;
  /** Why this step exists, in recruiter language. */
  why: string;
  /** What this step outputs, or what the user needs to do. */
  produces: string;
  outcomes: Array<{
    tone: OutcomeTone;
    /** "If you approve" / "No duplicate". */
    label: string;
    /** What actually happens on that path. */
    text: string;
  }>;
};

type BranchingSpec = {
  router: RouterKey;
  labels: readonly [string, ...string[]];
};

/**
 * Deterministic branching metadata per tool key.
 * Outgoing edge labels from the LLM must match exactly — no synonyms.
 */
const BRANCHING_BY_TOOL: Partial<Record<ToolKey, BranchingSpec>> = {
  "syntra.duplicate.detect": {
    router: "result.has_duplicate_or_end",
    labels: ["duplicate_found", "no_duplicate"],
  },
  "human.gate": {
    router: "result.approved_or_end",
    labels: ["approved", "rejected"],
  },
};

/** Branch labels that mean the flow proceeds / is clean. */
const POSITIVE_EDGE_LABELS = new Set([
  "approved",
  "no_duplicate",
]);

/** Branch labels that mean stop / needs intervention. */
const NEGATIVE_EDGE_LABELS = new Set([
  "rejected",
  "duplicate_found",
]);

/** Tools that represent terminal visual states (distinct from __end__ edge sentinel). */
const END_VISUAL_TOOLS = new Set<string>();

/**
 * Static recruiter-facing copy per tool key — hand-written, never from the LLM.
 * LLM description is used only as the short node label on the graph.
 */
const NODE_COPY_BY_TOOL: Record<ToolKey, NodeCopy> = {
  "syntra.jd.process": {
    title: "Process job description",
    kicker: "Automatic step",
    why: "A new job has arrived and needs to be turned into clear requirements before anyone can match candidates to it. Doing this automatically keeps intake consistent and fast.",
    produces: "A structured set of role requirements ready for matching — skills, experience, and other must-haves pulled from the job text.",
    outcomes: [],
  },
  "syntra.resume.process": {
    title: "Process resume",
    kicker: "Automatic step",
    why: "A new resume has come in. Before you can search for duplicates or match to jobs, the profile needs to be read and organized into a standard format.",
    produces: "A prepared candidate profile with skills, experience, and contact details ready for the next steps in the workflow.",
    outcomes: [],
  },
  "syntra.match.process": {
    title: "Match to job",
    kicker: "Automatic step",
    why: "You need to know how well this candidate fits a specific role. Scoring happens against the job requirements so you can focus on the strongest fits first.",
    produces: "A match score and summary for this job × candidate pair, ready to show in your shortlist.",
    outcomes: [],
  },
  "syntra.continuous.match": {
    title: "Match against the bench",
    kicker: "Automatic step",
    why: "A job is ready and you want to see who already on the bench might fit — without waiting for someone to run a search by hand.",
    produces: "A list of bench candidates who look like a good fit for this requirement, ready for you to review.",
    outcomes: [],
  },
  "syntra.duplicate.detect": {
    title: "Duplicate detection",
    kicker: "Automatic step",
    why: "The same person sometimes applies more than once, or their details land in the system under slightly different records. Catching that early avoids treating one person as two.",
    produces: "A yes/no signal: either a probable duplicate was found, or this profile looks unique so far.",
    outcomes: [
      {
        tone: "negative",
        label: "Duplicate found",
        text: "A likely match was found. The workflow pauses so someone can compare the two profiles and decide what to do.",
      },
      {
        tone: "positive",
        label: "No duplicate",
        text: "No probable duplicate turned up. The workflow continues with this profile as a distinct candidate.",
      },
    ],
  },
  "syntra.bench.alert": {
    title: "Alert matching jobs",
    kicker: "Automatic step",
    why: "A new candidate is on the bench and live roles may already need them. Flagging those roles early means recruiters see the opportunity sooner.",
    produces: "Alerts or match requests for live requirements that look like a fit for this candidate.",
    outcomes: [],
  },
  "syntra.shortlist.notify": {
    title: "Update shortlist",
    kicker: "Automatic step",
    why: "Match results are ready, but your shortlist view only stays useful if it refreshes when new scores land. This step keeps that view current.",
    produces: "An updated shortlist signal so recruiters see the latest match results for this job.",
    outcomes: [],
  },
  "syntra.duplicate.merge": {
    title: "Merge candidates",
    kicker: "Automatic step",
    why: "Someone has already decided these two profiles are the same person. Combining them keeps one complete history instead of split records.",
    produces: "A single merged candidate record that keeps the full history from both profiles — or leaves them separate if the decision was to keep them apart.",
    outcomes: [],
  },
  "syntra.run.retry": {
    title: "Retry failed run",
    kicker: "Automatic step",
    why: "Something went wrong earlier and the run stopped. Asking the system to try again can clear temporary failures without you rebuilding the whole flow.",
    produces: "A replay of the failed run so processing can continue from where it stalled.",
    outcomes: [],
  },
  "astra.requirement.intake": {
    title: "Read job from email",
    kicker: "Automatic step",
    why: "A job description arrived by email. This pulls it into intake so later steps can clean it up and decide if matching should run.",
    produces: "The email job text stored and ready for quality checks.",
    outcomes: [],
  },
  "astra.requirement.ingest": {
    title: "Save job description",
    kicker: "Automatic step",
    why: "A job was shared outside email (paste, upload, or API). Saving it keeps every JD in one place before enrichment.",
    produces: "A stored job record ready for the next intake steps.",
    outcomes: [],
  },
  "astra.jobboard.fetch": {
    title: "Fetch jobs from job boards",
    kicker: "Automatic step",
    why: "You asked to pull open roles from job boards instead of pasting them by hand. This brings those listings into intake.",
    produces: "One or more job listings ready to clean up and route to matching.",
    outcomes: [],
  },
  "astra.requirement.quality": {
    title: "Check JD quality",
    kicker: "Automatic step",
    why: "Incomplete job descriptions waste recruiter time. This scores how complete the JD is before deeper enrichment or matching.",
    produces: "A quality score and notes about what is missing or unclear.",
    outcomes: [],
  },
  "astra.requirement.normalize": {
    title: "Clean up & structure JD",
    kicker: "Automatic step",
    why: "Raw job text is messy. This extracts skills, role, and other must-haves into a clear structure recruiters and matching can use.",
    produces: "A cleaned, structured job ready for the route / matching hand-off.",
    outcomes: [],
  },
  "astra.route.decision": {
    title: "Send to matching or stop",
    kicker: "Automatic step",
    why: "Only good-enough jobs should go to candidate matching. Weak ones should stop so someone can fix them later.",
    produces: "A decision: continue into SYNTRA matching, or stop this job for now.",
    outcomes: [],
  },
  "orbit.lifecycle.transition": {
    title: "Update bench status",
    kicker: "ORBIT step",
    why: "Recruiters move consultants across Available, Bench, Notice, Placed, Hold, and related statuses so the bench view stays accurate.",
    produces: "A new lifecycle state on the candidate with optional note.",
    outcomes: [],
  },
  "orbit.placement.confirm": {
    title: "Confirm client placement",
    kicker: "ORBIT step",
    why: "When a consultant is placed at a client, bill/pay rates and employment model need to be locked in.",
    produces: "An active placement record and a Placed lifecycle state.",
    outcomes: [],
  },
  "orbit.revenue.arrange": {
    title: "Set revenue arrangement",
    kicker: "ORBIT step",
    why: "Placement economics (markup, margin, flat fee, etc.) drive profitability tracking.",
    produces: "A current revenue arrangement on the placement.",
    outcomes: [],
  },
  "orbit.activity.note": {
    title: "Add recruiter note",
    kicker: "ORBIT step",
    why: "Timeline notes keep the team aligned on outreach, holds, and placement context.",
    produces: "An activity entry on the candidate timeline.",
    outcomes: [],
  },
  "orbit.route.decision": {
    title: "Route after status change",
    kicker: "ORBIT step",
    why: "After a lifecycle change, the flow branches: placed continues placement work; hold stops for attention; otherwise stays on active bench.",
    produces: "A branch key (placed / hold / active) and optional hold signal.",
    outcomes: [],
  },
  "orch.branch.decision": {
    title: "Pick what happens next",
    kicker: "Automatic step",
    why: "Based on an earlier score, the workflow picks what to do next — continue automatically, ask a person, or stop.",
    produces: "A clear path for the next step so the run does not guess.",
    outcomes: [
      {
        tone: "positive",
        label: "Continue",
        text: "Quality looks good enough — the workflow keeps going automatically.",
      },
      {
        tone: "negative",
        label: "Needs a person / stop",
        text: "Something needs a human look, or the run should stop.",
      },
    ],
  },
  "human.gate": {
    title: "Human review",
    kicker: "Needs a person",
    why: "Two candidate profiles look like the same person, but the match isn't certain enough to combine them automatically. Someone needs to look at both and make the call.",
    produces:
      "Open the flagged pair, compare the two profiles side by side — name, contact details, work history — and decide whether they're really the same candidate.",
    outcomes: [
      {
        tone: "positive",
        label: "If you approve",
        text: "The two profiles are combined into one, keeping the full history from both.",
      },
      {
        tone: "negative",
        label: "If you reject",
        text: "Nothing is merged. Both profiles stay separate and the workflow ends.",
      },
    ],
  },
};

const SENTINEL_COPY: Record<"__start__" | "__end__", NodeCopy> = {
  __start__: {
    title: "Start",
    kicker: "Start",
    why: "This is where the workflow begins when a new resume or related event arrives.",
    produces: "Hand-off into the first automatic step so processing can begin.",
    outcomes: [],
  },
  __end__: {
    title: "End",
    kicker: "End",
    why: "This marks the end of the workflow for this run — either everything finished cleanly, or a path stopped after a decision.",
    produces: "No further steps. The run is complete.",
    outcomes: [],
  },
};

const FALLBACK_COPY: NodeCopy = {
  title: "Workflow step",
  kicker: "Automatic step",
  why: "This step is part of the workflow. Open it to see what happens next in the process.",
  produces: "Moves the workflow forward to the next step.",
  outcomes: [],
};

/**
 * Resolve the canvas node type from a tool key alone.
 * Start/end sentinels are edge-only; if they appear as tool keys they map to start/end.
 */
export function resolveNodeType(toolKey: string): VisualNodeType {
  if (toolKey === "__start__") return "start";
  if (toolKey === "__end__") return "end";
  if (toolKey === "human.gate") return "human_gate";
  if (END_VISUAL_TOOLS.has(toolKey)) return "end";
  return "ai_action";
}

/** Allowed outgoing edge labels for a branching tool, or null when only unlabeled edges are valid. */
export function resolveEdgeLabels(toolKey: string): readonly string[] | null {
  if (!isRegisteredTool(toolKey)) return null;
  return BRANCHING_BY_TOOL[toolKey]?.labels ?? null;
}

/** Runtime router key for a branching tool — derived in code, never from LLM output. */
export function resolveRouterKey(toolKey: string): RouterKey | null {
  if (!isRegisteredTool(toolKey)) return null;
  return BRANCHING_BY_TOOL[toolKey]?.router ?? null;
}

export function isBranchingTool(toolKey: string): boolean {
  return isRegisteredTool(toolKey) && toolKey in BRANCHING_BY_TOOL;
}

export function isEndVisualTool(toolKey: string): boolean {
  return END_VISUAL_TOOLS.has(toolKey);
}

export type ToolFamily = "syntra" | "astra" | "orbit" | "platform" | "none";

/**
 * Which product family a tool belongs to — for naive-admin labeling on the canvas.
 * - syntra: matching / profile / shortlist tools
 * - astra: intake / JD quality / route tools
 * - orbit: bench / lifecycle / placement / revenue tools
 * - platform: orch.branch / human.gate (shared orchestration)
 */
export function resolveToolFamily(toolKey: string): ToolFamily {
  if (toolKey === "__start__" || toolKey === "__end__") return "none";
  if (toolKey.startsWith("syntra.")) return "syntra";
  if (toolKey.startsWith("astra.")) return "astra";
  if (toolKey.startsWith("orbit.")) return "orbit";
  if (toolKey === "human.gate" || toolKey.startsWith("orch.")) return "platform";
  return "none";
}

export function toolFamilyLabel(family: ToolFamily): string {
  switch (family) {
    case "syntra":
      return "SYNTRA tool";
    case "astra":
      return "ASTRA tool";
    case "orbit":
      return "ORBIT tool";
    case "platform":
      return "Platform step";
    default:
      return "";
  }
}

export function toolFamilyBlurb(family: ToolFamily): string {
  switch (family) {
    case "syntra":
      return "This step calls a SYNTRA tool (matching, profiles, shortlist, duplicates).";
    case "astra":
      return "This step calls an ASTRA tool (intake, job boards, JD quality / structuring / routing).";
    case "orbit":
      return "This step calls an ORBIT tool (bench lifecycle, placement, revenue, notes).";
    case "platform":
      return "This step is shared orchestration (branching or human review) — not product APIs.";
    default:
      return "";
  }
}

/** Static recruiter-facing copy for a tool key or start/end sentinel. */
export function resolveNodeCopy(toolKey: string): NodeCopy {
  if (toolKey === "__start__" || toolKey === "__end__") {
    return SENTINEL_COPY[toolKey];
  }
  if (isRegisteredTool(toolKey)) {
    const copy = NODE_COPY_BY_TOOL[toolKey];
    if (copy) return copy;
  }
  return FALLBACK_COPY;
}

/** Green / red tone for a branch edge label — null when unlabeled or unknown. */
export function resolveEdgeTone(label: string | null | undefined): OutcomeTone | null {
  if (!label) return null;
  const key = label.trim().toLowerCase().replace(/\s+/g, "_");
  if (POSITIVE_EDGE_LABELS.has(key)) return "positive";
  if (NEGATIVE_EDGE_LABELS.has(key)) return "negative";
  return null;
}

/** Human-readable branch label for the graph (no underscores / internal keys). */
export function displayEdgeLabel(label: string): string {
  const tone = resolveEdgeTone(label);
  if (tone === "positive") {
    if (/no.?duplicate/i.test(label)) return "No duplicate";
    if (/approv/i.test(label)) return "Approved";
  }
  if (tone === "negative") {
    if (/duplicate/i.test(label)) return "Duplicate found";
    if (/reject/i.test(label)) return "Rejected";
  }
  return label.replace(/_/g, " ");
}
