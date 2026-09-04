import { GenerationFailedError } from "./parse-llm-graph.js";
import { z } from "zod";
import { listToolKeys } from "./tool-registry.js";

const TOOL_KEYS = listToolKeys();
const toolKeySchema = z.enum(TOOL_KEYS as [string, ...string[]]);

export const LlmGraphNodeSchema = z.object({
  id: z.string().min(1),
  toolKey: toolKeySchema,
  description: z.string(),
});

export const LlmGraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().nullable(),
});

export const LlmGraphProposalSchema = z.object({
  nodes: z.array(LlmGraphNodeSchema).min(1),
  edges: z.array(LlmGraphEdgeSchema).min(1),
  unsupported: z.array(z.string()).default([]),
});

export type LlmGraphProposal = z.infer<typeof LlmGraphProposalSchema>;
export type LlmGraphNode = z.infer<typeof LlmGraphNodeSchema>;
export type LlmGraphEdge = z.infer<typeof LlmGraphEdgeSchema>;

export const LlmUnsupportedProposalSchema = z.object({
  error: z.literal("UNSUPPORTED_REQUEST"),
  message: z.string(),
  unsupported: z.array(z.string()).default([]),
});

/** JSON Schema passed to provider structured-output APIs (strict). */
/**
 * The schema the provider is given, which CONSTRAINS what the model may emit.
 *
 * `allowedToolKeys` is not optional in spirit. Structured output sends this
 * schema to the model, and the decoder can only produce values from the enum —
 * so an enum listing every node in the system tells the model those are all
 * legal, however carefully the prose above it says otherwise. That is exactly
 * how a SYNTRA author's workflow came back with ASTRA steps in it: eleven nodes
 * in the catalogue, eleven in the rules, and twenty-two in the enum. The enum
 * won, because it is the only one of the three the sampler enforces.
 */
export function buildLlmGraphJsonSchema(
  allowedToolKeys: readonly string[] = TOOL_KEYS,
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["nodes", "edges", "unsupported"],
    properties: {
      nodes: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "toolKey", "description"],
          properties: {
            id: { type: "string", minLength: 1 },
            toolKey: { type: "string", enum: [...allowedToolKeys] },
            description: { type: "string" },
          },
        },
      },
      edges: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "source", "target", "label"],
          properties: {
            id: { type: "string", minLength: 1 },
            source: { type: "string", minLength: 1 },
            target: { type: "string", minLength: 1 },
            label: { type: ["string", "null"] },
          },
        },
      },
      unsupported: {
        type: "array",
        items: { type: "string" },
      },
    },
  };
}

export function validateLlmGraphProposalSchema(
  value: unknown,
): LlmGraphProposal {
  const unsupported = LlmUnsupportedProposalSchema.safeParse(value);
  if (unsupported.success) {
    const u = unsupported.data;
    const detail =
      u.unsupported.length > 0
        ? `${u.message} Unsupported: ${u.unsupported.join(", ")}.`
        : u.message;
    throw new GenerationFailedError(detail);
  }

  const parsed = LlmGraphProposalSchema.safeParse(value);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new GenerationFailedError(`LLM proposal failed schema validation: ${detail}`);
  }
  return parsed.data;
}
