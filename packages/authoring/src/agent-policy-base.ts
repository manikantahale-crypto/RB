import { z } from "zod";

/**
 * Shared base — fields EVERY agent (product) has (design §4.1).
 */
export const AgentPolicyBase = z.object({
  agentId: z.string().uuid(),
  agentKey: z.string().min(1),
  retry: z
    .object({
      max: z.number().int().min(0).max(10).default(3),
      fallback: z
        .enum(["human_review", "skip", "fail"])
        .default("human_review"),
    })
    .default({ max: 3, fallback: "human_review" }),
  escalation: z.enum(["none", "human", "other_agent"]).default("none"),
  guardrails: z
    .object({
      piiRedact: z.boolean().default(false),
      maxOutputTokens: z.number().int().positive().optional(),
    })
    .default({ piiRedact: false }),
});

export type AgentPolicyBaseType = z.infer<typeof AgentPolicyBase>;
