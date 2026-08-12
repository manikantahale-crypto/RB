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
  /** Optional free-text prompt overlay for Stage 1 editor. */
  prompt: z.string().min(1).optional(),
  allowedTools: z.array(z.string().min(1)).optional(),
});

export const IntakePolicyExt = z.object({
  autoClassify: z.boolean().default(true),
  prompt: z.string().min(1).optional(),
  allowedTools: z.array(z.string().min(1)).optional(),
});

export const CopilotPolicyExt = z.object({
  maxTurns: z.number().int().min(1).max(50).default(12),
  prompt: z.string().min(1).optional(),
  allowedTools: z.array(z.string().min(1)).optional(),
});

export const POLICY_EXT_REGISTRY = {
  SyntraPolicyExt,
  IntakePolicyExt,
  CopilotPolicyExt,
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
