import type { LLMClient } from "./llm/types.js";
import {
  GenerationFailedError,
  parseLlmGraphJson,
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
  /** Parsed JSON object — not yet schema/topology validated (step 6). */
  proposal: Record<string, unknown>;
  /** Parts of the request the model says it could not fulfill. */
  unsupported: string[];
  model: string;
};

/**
 * Call the LLM and defensively parse a graph proposal (§8 step 5).
 * Retries once on malformed / unclosed JSON (Layer 5).
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
            : `${request}\n\n(Previous reply was invalid JSON. Respond with ONE compact JSON object only.)`,
        temperature: args.temperature ?? 0.2,
        maxTokens: args.maxTokens ?? 4096,
        model: args.model,
      });
      rawText = result.text ?? "";
      model = result.model;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new GenerationFailedError(`LLM call failed: ${msg}`, { cause: err });
    }

    try {
      const { proposal, unsupported } = parseLlmGraphJson(rawText);
      return { rawText, proposal, unsupported, model };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable =
        /malformed JSON|unclosed JSON|empty text|did not contain a JSON/i.test(
          msg,
        );
      if (!retryable || attempt === 1) throw err;
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new GenerationFailedError("LLM proposal failed after retry");
}
