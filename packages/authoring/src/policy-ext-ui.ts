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
      label: "Extra instructions for this agent (optional)",
      kind: "textarea",
      hint: "Plain English is fine — e.g. “Be strict about visa requirements.”",
      defaultValue: "",
    },
  ],
  IntakePolicyExt: [
    {
      key: "prompt",
      label: "Extra instructions for this agent (optional)",
      kind: "textarea",
      defaultValue: "",
    },
    {
      key: "autoClassify",
      label: "Automatically sort incoming items",
      kind: "boolean",
      defaultValue: true,
    },
  ],
  CopilotPolicyExt: [
    {
      key: "prompt",
      label: "Extra instructions for this agent (optional)",
      kind: "textarea",
      defaultValue: "",
    },
    {
      key: "maxTurns",
      label: "Max back-and-forth messages in one chat",
      kind: "number",
      min: 1,
      max: 50,
      defaultValue: 12,
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
