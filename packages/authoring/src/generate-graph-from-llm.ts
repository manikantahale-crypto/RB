import { createHash } from "node:crypto";
import type { LLMClient } from "./llm/types.js";
import type { EventCatalogEntry } from "./event-catalog.js";
import { buildGraphSystemPrompt } from "./build-graph-prompt.js";
import { proposeGraphFromLlm } from "./propose-graph-from-llm.js";
import { validateLlmGraphProposal } from "./validate-llm-graph.js";
import { mergeUnsupported, outOfScopeLabels } from "./request-scope.js";
import type { GraphDefinition } from "./graph-definition.js";
import { summarizeGraphWorkflow } from "./summarize-graph.js";

export type GenerateGraphFromLlmArgs = {
  llm: LLMClient;
  userRequest: string;
  events: EventCatalogEntry[];
  /** e.g. syntra.authored */
  graphKey: string;
  temperature?: number;
};

export type GenerateGraphFromLlmResult = {
  definition: GraphDefinition;
  source: string;
  checksum: string;
  graphKey: string;
  /** Raw LLM text kept for audit; not required for storage. */
  rawText: string;
  model: string;
  /** Gap report: what the admin asked that we could not build. */
  unsupported: string[];
  /** Readable built steps (Layer 3). */
  builtSummary: string;
};

/**
 * Propose via LLM → parse → validate (steps 5–6).
 * On any failure throws GenerationFailedError — nothing to store.
 */
export async function generateGraphFromLlm(
  args: GenerateGraphFromLlmArgs,
): Promise<GenerateGraphFromLlmResult> {
  const systemPrompt = buildGraphSystemPrompt({ events: args.events });
  const { rawText, proposal, unsupported: fromLlm, model } =
    await proposeGraphFromLlm({
      llm: args.llm,
      systemPrompt,
      userRequest: args.userRequest,
      temperature: args.temperature ?? 0.2,
    });

  const definition = validateLlmGraphProposal(proposal, {
    defaultGraphKey: args.graphKey,
  });

  // Canonical key from caller (agent identity), not whatever the model invents.
  const locked: GraphDefinition = {
    ...definition,
    graphKey: args.graphKey,
  };

  const source = `${JSON.stringify(locked, null, 2)}\n`;
  const checksum = createHash("sha256").update(source).digest("hex");
  const unsupported = mergeUnsupported(
    fromLlm,
    outOfScopeLabels(args.userRequest),
  );
  const builtSummary = summarizeGraphWorkflow(locked).line;

  return {
    definition: locked,
    source,
    checksum,
    graphKey: args.graphKey,
    rawText,
    model,
    unsupported,
    builtSummary,
  };
}
