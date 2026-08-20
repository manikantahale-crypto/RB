/**
 * Generic LLM client seam for authoring (llm-graph-generator-design §9 #1).
 * Mirrors packages/orchestrator/src/llm — one interface, any provider behind it.
 */

export type LLMCompleteRequest = {
  /** User / request message (admin English, etc.). */
  prompt: string;
  system?: string;
  model?: string;
  maxTokens?: number;
  /** Low temperature preferred for graph generation (§9 #6). */
  temperature?: number;
  /**
   * When set, providers that support structured output must return JSON
   * matching this schema (strict). Used for graph generation.
   */
  responseJsonSchema?: Record<string, unknown>;
};

export type LLMCompleteResult = {
  text: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
};

/** One method: system + user → text. Providers swap behind this. */
export type LLMClient = {
  complete: (req: LLMCompleteRequest) => Promise<LLMCompleteResult>;
};
