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
    label: "Retry max",
    kind: "number",
    min: 0,
    max: 10,
    defaultValue: 3,
  },
  {
    key: "retry.fallback",
    label: "Retry fallback",
    kind: "enum",
    options: ["human_review", "skip", "fail"],
    defaultValue: "human_review",
  },
  {
    key: "escalation",
    label: "Escalation",
    kind: "enum",
    options: ["none", "human", "other_agent"],
    defaultValue: "none",
  },
  {
    key: "guardrails.piiRedact",
    label: "PII redact",
    kind: "boolean",
    defaultValue: false,
  },
  {
    key: "guardrails.maxOutputTokens",
    label: "Max output tokens",
    kind: "number",
    hint: "Optional positive integer",
    defaultValue: "",
  },
];

export const POLICY_EXT_UI: Record<string, PolicyFieldDesc[]> = {
  SyntraPolicyExt: [
    {
      key: "prompt",
      label: "System prompt",
      kind: "textarea",
      hint: "Optional overlay instructions for SYNTRA",
      defaultValue: "",
    },
    {
      key: "matchThreshold",
      label: "Match threshold (0–100)",
      kind: "number",
      min: 0,
      max: 100,
      defaultValue: 60,
    },
    {
      key: "hardFilters",
      label: "Hard filters",
      kind: "multiEnum",
      options: ["location", "visa", "availability", "experience"],
      defaultValue: [],
    },
    {
      key: "rerank",
      label: "Rerank results",
      kind: "boolean",
      defaultValue: true,
    },
    {
      key: "allowedTools",
      label: "Allowed tools",
      kind: "tools",
      hint: "Optional override; empty = template node impls only at generate time",
      defaultValue: [],
    },
  ],
  IntakePolicyExt: [
    {
      key: "prompt",
      label: "System prompt",
      kind: "textarea",
      defaultValue: "",
    },
    {
      key: "autoClassify",
      label: "Auto-classify arrivals",
      kind: "boolean",
      defaultValue: true,
    },
    {
      key: "allowedTools",
      label: "Allowed tools",
      kind: "tools",
      defaultValue: [],
    },
  ],
  CopilotPolicyExt: [
    {
      key: "prompt",
      label: "System prompt",
      kind: "textarea",
      defaultValue: "",
    },
    {
      key: "maxTurns",
      label: "Max turns",
      kind: "number",
      min: 1,
      max: 50,
      defaultValue: 12,
    },
    {
      key: "allowedTools",
      label: "Allowed tools",
      kind: "tools",
      defaultValue: [],
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
