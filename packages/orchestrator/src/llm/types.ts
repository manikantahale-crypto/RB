/** Thin LLM seam (design §4.1) — real providers later; nodes must not import SDKs. */
export type LLMCompleteRequest = {
  prompt: string;
  system?: string;
  model?: string;
  maxTokens?: number;
};

export type LLMCompleteResult = {
  text: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
};

export type LLMClient = {
  complete: (req: LLMCompleteRequest) => Promise<LLMCompleteResult>;
};
