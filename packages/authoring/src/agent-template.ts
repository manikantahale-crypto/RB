import { z } from "zod";

/**
 * Agent template — per-product data for the schema-driven generator (design §5A / A6).
 * Behaviour lives in the node/tool registry; templates only wire + parameterise.
 */

export const TemplateNodeSchema = z.object({
  id: z.string().min(1),
  impl: z.string().min(1), // registry key
  configFrom: z.array(z.string().min(1)).optional(),
});

export const AgentTemplateSchema = z.object({
  agentKey: z.string().min(1),
  displayName: z.string().min(1),
  /** Name of a registered policyExt Zod schema (e.g. SyntraPolicyExt). */
  policyExt: z.string().min(1),
  nodes: z.array(TemplateNodeSchema).min(1),
  wiring: z.array(z.tuple([z.string().min(1), z.string().min(1)])).min(1),
  conditionalOn: z.record(z.string(), z.string()).default({}),
});

export type AgentTemplate = z.infer<typeof AgentTemplateSchema>;
export type TemplateNode = z.infer<typeof TemplateNodeSchema>;
