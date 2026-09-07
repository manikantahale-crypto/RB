import type { LLMClient } from "./llm/types.js";
import {
  buildLlmGraphJsonSchema,
  validateLlmGraphProposalSchema,
  type LlmGraphProposal,
} from "./llm-graph-proposal-schema.js";
import {
  GenerationFailedError,
  extractJsonObjectText,
  isTransientProviderError,
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
  /**
   * The only keys the model may emit. Must be the SAME list the system prompt
   * describes — the enum is what the decoder enforces, so a wider one silently
   * overrules every rule in the prompt.
   */
  allowedToolKeys?: readonly string[];
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

  // Built per call, not once at module load: the allowed set is per author.
  const responseSchema = buildLlmGraphJsonSchema(args.allowedToolKeys);

  let lastErr: unknown;
  /**
   * Two kinds of failure, two kinds of retry.
   *
   * A reply that fails schema validation is retried ONCE, with a note telling
   * the model what went wrong — asking a third time rarely changes anything.
   *
   * The provider being busy is different: a 429 or a 503 has nothing to do
   * with the request, and waiting is the entire fix. Those get three attempts
   * with a growing pause, because the alternative is showing somebody a
   * placeholder and a quota URL for a description that was perfectly good.
   */
  const PROVIDER_ATTEMPTS = 3;
  const backoffMs = [0, 1500, 4000];

  for (let attempt = 0; attempt < 2; attempt++) {
    let rawText = "";
    let model = "";
    let called = false;
    let providerErr: unknown = null;

    for (let tries = 0; tries < PROVIDER_ATTEMPTS; tries += 1) {
      if (backoffMs[tries]) {
        await new Promise((r) => setTimeout(r, backoffMs[tries]));
      }
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
          responseJsonSchema: responseSchema,
        });
        rawText = result.text ?? "";
        model = result.model;
        called = true;
        break;
      } catch (err) {
        providerErr = err;
        // Anything that is not the provider being busy will fail the same way
        // on the next attempt, so waiting only delays the bad news.
        if (!isTransientProviderError(err)) break;
      }
    }

    if (!called) {
      const msg =
        providerErr instanceof Error ? providerErr.message : String(providerErr);
      throw new GenerationFailedError(`LLM call failed: ${msg}`, {
        cause: providerErr,
        transient: isTransientProviderError(providerErr),
      });
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
