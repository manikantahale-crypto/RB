import type { LLMClient } from "./llm/types.js";
import {
  buildLlmGraphJsonSchema,
  validateLlmGraphProposalSchema,
  type LlmGraphProposal,
} from "./llm-graph-proposal-schema.js";
import {
  GenerationFailedError,
  extractJsonObjectText,
} from "./parse-llm-graph.js";

export type ProposeGraphFromLlmArgs = {
  llm: LLMClient;
  /** Built via buildGraphSystemPrompt (catalog + events + rules). */
  systemPrompt: string;
  /** Admin plain-English request. */
  userRequest: string;
  /** Default 0.2 — low temperature (§9 #6). */
  temperature?: number;
  maxTokens?: number;
  model?: string;
};

export type ProposeGraphFromLlmResult = {
  /** Raw model text (for audit / debugging). */
  rawText: string;
  /** Schema-validated proposal — not yet compiled to GraphDefinition. */
  proposal: LlmGraphProposal;
  /** Parts of the request the model says it could not fulfill. */
  unsupported: string[];
  model: string;
};

const RESPONSE_SCHEMA = buildLlmGraphJsonSchema();

function parseStructuredProposal(raw: string): LlmGraphProposal {
  let text: string;
  try {
    text = extractJsonObjectText(raw);
  } catch (err) {
    if (err instanceof GenerationFailedError) throw err;
    throw new GenerationFailedError("failed to extract JSON from LLM text", {
      cause: err,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new GenerationFailedError("LLM returned malformed JSON", { cause: err });
  }

  return validateLlmGraphProposalSchema(parsed);
}

/**
 * Call the LLM with forced structured output and validate against the strict schema.
 * Retries once when JSON or schema validation fails.
 */
export async function proposeGraphFromLlm(
  args: ProposeGraphFromLlmArgs,
): Promise<ProposeGraphFromLlmResult> {
  const request = args.userRequest.trim();
  if (!request) {
    throw new GenerationFailedError("user request is empty");
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    let rawText: string;
    let model: string;
    try {
      const result = await args.llm.complete({
        system: args.systemPrompt,
        prompt:
          attempt === 0
            ? request
            : `${request}\n\n(Previous reply failed schema validation. Return ONE JSON object matching the required schema exactly.)`,
        temperature: args.temperature ?? 0.2,
        maxTokens: args.maxTokens ?? 4096,
        model: args.model,
        responseJsonSchema: RESPONSE_SCHEMA,
      });
      rawText = result.text ?? "";
      model = result.model;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new GenerationFailedError(`LLM call failed: ${msg}`, { cause: err });
    }

    try {
      const proposal = parseStructuredProposal(rawText);
      return {
        rawText,
        proposal,
        unsupported: proposal.unsupported ?? [],
        model,
      };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable =
        /malformed JSON|unclosed JSON|empty text|did not contain a JSON|schema validation/i.test(
          msg,
        );
      if (!retryable || attempt === 1) throw err;
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new GenerationFailedError("LLM proposal failed after retry");
}
