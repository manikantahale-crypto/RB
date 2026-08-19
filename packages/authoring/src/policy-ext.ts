import { z } from "zod";
import { AgentPolicyBase } from "./agent-policy-base.js";

/**
 * Per-agent policy extensions (design §4.1). Named by template.policyExt.
 */

export const SyntraPolicyExt = z.object({
  matchThreshold: z.number().min(0).max(100).default(60),
  hardFilters: z
    .array(z.enum(["location", "visa", "availability", "experience"]))
    .default([]),
  rerank: z.boolean().default(true),
  /** System / base instructions (Builder Policy Box). */
  prompt: z.string().min(1),
  /** Registered tool keys (multi-select). */
  allowedTools: z.array(z.string().min(1)).min(1),
  /** Primary trigger event_type (v1: single trigger per agent). */
  triggerEventType: z.string().min(1),
});

export const IntakePolicyExt = z.object({
  autoClassify: z.boolean().default(true),
  prompt: z.string().min(1),
  allowedTools: z.array(z.string().min(1)).min(1),
  triggerEventType: z.string().min(1),
});

/** ASTRA intake gate — normalize + route (Option B front door). */
export const AstraPolicyExt = z.object({
  prompt: z.string().min(1),
  allowedTools: z.array(z.string().min(1)).min(1),
  triggerEventType: z.string().min(1),
  /** Temporary permissive default until calibrated (Stage 4 follow-up). */
  minConfidence: z.number().min(0).max(1).default(0),
});

export const POLICY_EXT_REGISTRY = {
  SyntraPolicyExt,
  IntakePolicyExt,
  AstraPolicyExt,
} as const;

export type PolicyExtKey = keyof typeof POLICY_EXT_REGISTRY;

export function getPolicyExtSchema(name: string) {
  if (!(name in POLICY_EXT_REGISTRY)) {
    return null;
  }
  return POLICY_EXT_REGISTRY[name as PolicyExtKey];
}

/** Compose base + named extension (design: AgentPolicyBase.merge(policyExt)). */
export function policySchemaForExt(policyExtName: string) {
  const ext = getPolicyExtSchema(policyExtName);
  if (!ext) {
    throw new Error(`Unknown policyExt "${policyExtName}"`);
  }
  return AgentPolicyBase.merge(ext);
}
