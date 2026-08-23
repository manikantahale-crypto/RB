/**
 * UI field descriptors for Policy Editor.
 * Zod remains validation source of truth; this only drives form controls.
 *
 * Form is schema-driven: shared base + template.policyExt fields (design §4.1 / A6).
 */

export type PolicyFieldKind =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "enum"
  | "multiEnum"
  | "tools";

export type PolicyFieldDesc = {
  /** Dot path into the policy object, e.g. "retry.max" or "matchThreshold". */
  key: string;
  label: string;
  kind: PolicyFieldKind;
  options?: string[];
  /** Human labels for enum option values (admin-facing). */
  optionLabels?: Record<string, string>;
  min?: number;
  max?: number;
  hint?: string;
  /** Optional default when no saved policy. */
  defaultValue?: unknown;
};

/** @deprecated Prefer PolicyFieldDesc */
export type ExtFieldDesc = PolicyFieldDesc;
/** @deprecated Prefer PolicyFieldKind */
export type ExtFieldKind = PolicyFieldKind;

/** Shared AgentPolicyBase fields every agent shows (design §4.1). */
export const BASE_POLICY_UI: PolicyFieldDesc[] = [
  {
    key: "retry.max",
    label: "How many times to retry if something fails",
    kind: "number",
    min: 0,
    max: 10,
    hint: "Usually 2 or 3 is enough",
    defaultValue: 3,
  },
  {
    key: "retry.fallback",
    label: "If retries still fail",
    kind: "enum",
    options: ["human_review", "skip", "fail"],
    optionLabels: {
      human_review: "Ask a person to review",
      skip: "Skip and continue",
      fail: "Stop with an error",
    },
    defaultValue: "human_review",
  },
  {
    key: "escalation",
    label: "If the agent is stuck, hand off to",
    kind: "enum",
    options: ["none", "human", "other_agent"],
    optionLabels: {
      none: "Nobody (keep trying in place)",
      human: "A person",
      other_agent: "Another agent",
    },
    defaultValue: "none",
  },
  {
    key: "guardrails.piiRedact",
    label: "Hide personal information (names, emails, phone numbers)",
    kind: "boolean",
    defaultValue: false,
  },
  {
    key: "guardrails.maxOutputTokens",
    label: "Limit how long answers can be (optional)",
    kind: "number",
    hint: "Leave blank for no limit",
    defaultValue: "",
  },
];

export const POLICY_EXT_UI: Record<string, PolicyFieldDesc[]> = {
  SyntraPolicyExt: [
    {
      key: "prompt",
      label: "System prompt",
      kind: "textarea",
      hint: "Base instructions for this agent — how it should behave.",
      defaultValue: "Process Syntra hiring events using the selected tools.",
    },
    {
      key: "allowedTools",
      label: "Steps this agent may use",
      kind: "tools",
      hint:
        "Shared catalog for every agent — Syntra + ASTRA + ORBIT + branch + human.gate. " +
        "Select any orbit.* tools to put bench actions in this agent's workflow.",
      defaultValue: ["syntra.jd.process"],
    },
    {
      key: "triggerEventType",
      label: "When this runs (trigger)",
      kind: "enum",
      options: [
        "syntra.jd.received",
        "syntra.resume.received",
        "syntra.match.requested",
        "syntra.duplicate.review_required",
        "syntra.jd.normalized",
        "astra.requirement.received",
        "astra.email.received",
        "astra.jobboard.fetch_requested",
        "orbit.lifecycle.transition_requested",
        "orbit.placement.confirm_requested",
        "orbit.revenue.arrange_requested",
        "orbit.activity.note_requested",
      ],
      optionLabels: {
        "syntra.jd.received": "Job description received",
        "syntra.resume.received": "Resume received",
        "syntra.match.requested": "Match requested",
        "syntra.duplicate.review_required": "Duplicate review required",
        "syntra.jd.normalized": "JD normalized (ASTRA → SYNTRA bridge)",
        "astra.requirement.received": "ASTRA requirement received",
        "astra.email.received": "Email JD received",
        "astra.jobboard.fetch_requested": "Job-board fetch requested",
        "orbit.lifecycle.transition_requested": "ORBIT lifecycle transition requested",
        "orbit.placement.confirm_requested": "ORBIT placement confirm requested",
        "orbit.revenue.arrange_requested": "ORBIT revenue arrange requested",
        "orbit.activity.note_requested": "ORBIT activity note requested",
      },
      hint: "Which real event starts this graph (one per agent in v1).",
      defaultValue: "syntra.jd.received",
    },
    {
      key: "matchThreshold",
      label: "Match score threshold",
      kind: "number",
      min: 0,
      max: 100,
      defaultValue: 60,
    },
    {
      key: "rerank",
      label: "Rerank shortlist",
      kind: "boolean",
      defaultValue: true,
    },
    {
      key: "hardFilters",
      label: "Hard filters (on match step)",
      kind: "multiEnum",
      options: ["location", "visa", "availability", "experience"],
      hint: "Applied on syntra.match.process when the workflow includes match.",
      defaultValue: [],
    },
    {
      key: "passMin",
      label: "Branch passMin (if using orch.branch.decision)",
      kind: "number",
      min: 0,
      max: 1,
      hint: "confidence_score >= passMin → auto path (default 0.6).",
      defaultValue: 0.6,
    },
    {
      key: "humanMin",
      label: "Branch humanMin (if using orch.branch.decision)",
      kind: "number",
      min: 0,
      max: 1,
      hint: "Below passMin but >= humanMin → human.gate (default 0.35).",
      defaultValue: 0.35,
    },
  ],
  IntakePolicyExt: [
    {
      key: "prompt",
      label: "System prompt",
      kind: "textarea",
      defaultValue: "Interpret inbound documents and prepare profiles.",
    },
    {
      key: "allowedTools",
      label: "Steps this agent may use",
      kind: "tools",
      defaultValue: ["syntra.resume.process"],
    },
    {
      key: "triggerEventType",
      label: "When this runs (trigger)",
      kind: "enum",
      options: [
        "syntra.jd.received",
        "syntra.resume.received",
        "syntra.match.requested",
        "syntra.duplicate.review_required",
      ],
      optionLabels: {
        "syntra.jd.received": "Job description received",
        "syntra.resume.received": "Resume received",
        "syntra.match.requested": "Match requested",
        "syntra.duplicate.review_required": "Duplicate review required",
      },
      defaultValue: "syntra.resume.received",
    },
    {
      key: "autoClassify",
      label: "Automatically sort incoming items",
      kind: "boolean",
      defaultValue: true,
    },
  ],
  AstraPolicyExt: [
    {
      key: "prompt",
      label: "Policy statement (natural language)",
      kind: "textarea",
      hint: "ASTRA: channels → quality → branch (normalize | human | reject) → SYNTRA bridge.",
      defaultValue:
        "When a job description arrives (upload, email, or job board), score quality, " +
        "branch to normalize or human review, then route actionable work to SYNTRA via syntra.jd.normalized.",
    },
    {
      key: "allowedTools",
      label: "Steps this agent may use",
      kind: "tools",
      hint: "Shared catalog — ASTRA + branch + human.gate + optional ORBIT bench tools.",
      defaultValue: [
        "astra.requirement.intake",
        "astra.requirement.ingest",
        "astra.jobboard.fetch",
        "astra.requirement.quality",
        "astra.requirement.normalize",
        "orch.branch.decision",
        "human.gate",
        "astra.route.decision",
        "orbit.lifecycle.transition",
        "orbit.activity.note",
      ],
    },
    {
      key: "triggerEventType",
      label: "When this runs (trigger)",
      kind: "enum",
      options: [
        "syntra.jd.received",
        "astra.requirement.received",
        "astra.email.received",
        "astra.jobboard.fetch_requested",
        "astra.requirement.normalized",
      ],
      optionLabels: {
        "syntra.jd.received": "JD upload (Option B front door)",
        "astra.requirement.received": "ASTRA requirement received",
        "astra.email.received": "Email JD intake",
        "astra.jobboard.fetch_requested": "Job-board fetch requested",
        "astra.requirement.normalized": "Already normalized (thin route)",
      },
      defaultValue: "syntra.jd.received",
    },
    {
      key: "minConfidence",
      label: "Route min confidence (0–1)",
      kind: "number",
      min: 0,
      max: 1,
      hint: "astra.route.decision gate after normalize.",
      defaultValue: 0,
    },
    {
      key: "passMin",
      label: "Branch passMin (auto-normalize)",
      kind: "number",
      min: 0,
      max: 1,
      hint: "quality score >= passMin → normalize without human.",
      defaultValue: 0.6,
    },
    {
      key: "humanMin",
      label: "Branch humanMin (human review)",
      kind: "number",
      min: 0,
      max: 1,
      hint: "passMin > score >= humanMin → human.gate; below → reject.",
      defaultValue: 0.35,
    },
  ],
  OrbitPolicyExt: [
    {
      key: "prompt",
      label: "Policy statement (natural language)",
      kind: "textarea",
      hint: "ORBIT: lifecycle → route; placement → note; revenue. Independent of ASTRA/Syntra.",
      defaultValue:
        "ORBIT owns bench/workforce: transition candidate lifecycle, confirm placements, " +
        "arrange revenue, and write timeline notes. Independent of ASTRA JD intake and Syntra matching.",
    },
    {
      key: "allowedTools",
      label: "Steps this agent may use",
      kind: "tools",
      hint:
        "Orbit-owned tools (orbit.*). Other agents may also select these from the shared catalog.",
      defaultValue: [
        "orbit.lifecycle.transition",
        "orbit.placement.confirm",
        "orbit.revenue.arrange",
        "orbit.activity.note",
        "orbit.route.decision",
        "orch.branch.decision",
        "human.gate",
      ],
    },
    {
      key: "triggerEventType",
      label: "When this runs (trigger)",
      kind: "enum",
      options: [
        "orbit.lifecycle.transition_requested",
        "orbit.placement.confirm_requested",
        "orbit.revenue.arrange_requested",
        "orbit.activity.note_requested",
      ],
      optionLabels: {
        "orbit.lifecycle.transition_requested": "Lifecycle transition requested",
        "orbit.placement.confirm_requested": "Placement confirm requested",
        "orbit.revenue.arrange_requested": "Revenue arrange requested",
        "orbit.activity.note_requested": "Activity note requested",
      },
      defaultValue: "orbit.lifecycle.transition_requested",
    },
  ],
};

export function baseFieldsFor(): PolicyFieldDesc[] {
  return BASE_POLICY_UI;
}

export function extFieldsFor(policyExt: string): PolicyFieldDesc[] {
  return POLICY_EXT_UI[policyExt] ?? [];
}

/** Base + extension descriptors for one agent template.policyExt. */
export function formFieldsFor(policyExt: string): {
  base: PolicyFieldDesc[];
  ext: PolicyFieldDesc[];
  all: PolicyFieldDesc[];
} {
  const base = baseFieldsFor();
  const ext = extFieldsFor(policyExt);
  return { base, ext, all: [...base, ...ext] };
}

/**
 * Admin Policy Box — one free-text field. LLM reads this on Create workflow.
 * Tools, threshold, and trigger defaults are filled on the server unless set in Advanced.
 */
export function policyMainFieldsFor(policyExt: string): PolicyFieldDesc[] {
  return policyBoxFieldsFor(policyExt);
}

/** Optional go-live setting — not used to build the graph (LLM uses policy text). */
export function policyIngressFieldsFor(policyExt: string): PolicyFieldDesc[] {
  const trigger = extFieldsFor(policyExt).find((f) => f.key === "triggerEventType");
  return trigger ? [trigger] : [];
}

/** Retry, escalation, guardrails — collapsible Advanced section. */
export function policyAdvancedFieldsFor(): PolicyFieldDesc[] {
  return baseFieldsFor();
}

/**
 * Admin-facing Policy Box — one free-text field.
 */
export function policyBoxFieldsFor(policyExt: string): PolicyFieldDesc[] {
  const ext = extFieldsFor(policyExt);
  const prompt = ext.find((f) => f.key === "prompt");
  if (prompt) {
    return [
      {
        ...prompt,
        label: "Policy",
        hint:
          "Write what this agent should do in plain English, then use Generate workflow below.",
      },
    ];
  }
  return [
    {
      key: "prompt",
      label: "Policy",
      kind: "textarea",
      hint:
        "Write what this agent should do in plain English, then use Generate workflow below.",
      defaultValue: "",
    },
  ];
}

/**
 * Fill hidden policy fields (tools, trigger, retries, etc.) from template defaults
 * before server validation / graph generation.
 */
export function enrichPolicyFromDefaults(
  raw: Record<string, unknown>,
  policyExt: string,
): Record<string, unknown> {
  const { all } = formFieldsFor(policyExt);
  let out = defaultFormValues(all);
  for (const f of all) {
    const v = getPath(raw, f.key);
    if (v === undefined || v === null) continue;
    if ((f.kind === "text" || f.kind === "textarea") && v === "") continue;
    if (f.kind === "number" && v === "") continue;
    out = setPath(out, f.key, v);
  }
  if (typeof raw.agentId === "string") out.agentId = raw.agentId;
  if (typeof raw.agentKey === "string") out.agentKey = raw.agentKey;

  for (const f of all) {
    if (f.kind !== "number") continue;
    const v = getPath(out, f.key);
    if (v === "" || v === null || v === undefined) {
      out = omitPath(out, f.key);
    }
  }

  return out;
}

export function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function setPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const parts = path.split(".");
  if (parts.length === 1) {
    return { ...obj, [path]: value };
  }
  const [head, ...rest] = parts;
  const child = (obj[head!] as Record<string, unknown> | undefined) ?? {};
  return {
    ...obj,
    [head!]: setPath(
      { ...child },
      rest.join("."),
      value,
    ),
  };
}

function omitPath(
  obj: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  const parts = path.split(".");
  if (parts.length === 1) {
    const { [path]: _removed, ...rest } = obj;
    return rest;
  }
  const [head, ...restParts] = parts;
  const child = obj[head!];
  if (child == null || typeof child !== "object") return obj;
  const next = omitPath(
    { ...(child as Record<string, unknown>) },
    restParts.join("."),
  );
  if (Object.keys(next).length === 0) {
    const { [head!]: _removed, ...rest } = obj;
    return rest;
  }
  return { ...obj, [head!]: next };
}

export function defaultFormValues(fields: PolicyFieldDesc[]): Record<string, unknown> {
  let out: Record<string, unknown> = {};
  for (const f of fields) {
    const def =
      f.defaultValue !== undefined
        ? f.defaultValue
        : f.kind === "boolean"
          ? false
          : f.kind === "multiEnum" || f.kind === "tools"
            ? []
            : f.kind === "number"
              ? ""
              : "";
    out = setPath(out, f.key, def);
  }
  return out;
}

/** Merge saved policy onto defaults for the given field set. */
export function valuesFromPolicy(
  policy: Record<string, unknown> | null,
  fields: PolicyFieldDesc[],
): Record<string, unknown> {
  let out = defaultFormValues(fields);
  if (!policy) return out;
  for (const f of fields) {
    const v = getPath(policy, f.key);
    if (v !== undefined) {
      out = setPath(out, f.key, v);
    }
  }
  return out;
}

/**
 * Build a policy payload from form values + identity.
 * Coerces number fields; drops empty optional strings/numbers.
 */
export function buildPolicyFromForm(
  agentId: string,
  agentKey: string,
  values: Record<string, unknown>,
  fields: PolicyFieldDesc[],
): Record<string, unknown> {
  let payload: Record<string, unknown> = {
    agentId,
    agentKey,
  };

  for (const f of fields) {
    let v = getPath(values, f.key);
    if (f.kind === "number") {
      if (v === "" || v === null || v === undefined) {
        continue;
      }
      v = typeof v === "number" ? v : Number(v);
      if (Number.isNaN(v as number)) continue;
    }
    if (f.kind === "textarea" || f.kind === "text") {
      if (v === "" || v === undefined || v === null) continue;
    }
    if (f.kind === "tools" || f.kind === "multiEnum") {
      if (!Array.isArray(v)) v = [];
    }
    payload = setPath(payload, f.key, v);
  }

  return payload;
}
