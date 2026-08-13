import type { LLMClient } from "./types.js";

/** Default for unit tests — never calls a network. */
export const noopLlm: LLMClient = {
  async complete(req) {
    return {
      text: "",
      model: req.model ?? "noop",
      usage: { promptTokens: 0, completionTokens: 0 },
    };
  },
};
