import type { LLMClient } from './types.js';

/** Default until a real LLMClient is wired (design: Noop for tests / Phase 1). */
export const noopLlm: LLMClient = {
  async complete(req) {
    return {
      text: '',
      model: req.model ?? 'noop',
      usage: { promptTokens: 0, completionTokens: 0 },
    };
  },
};
