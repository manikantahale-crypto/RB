const { getEmbeddingClient } = require("../core/aiClient");
const log = require("../utils/logger");

const EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL || "text-embedding-3-small";
const EMBEDDING_VERSION = "v1";

/**
 * Generate 1536-dimensional vector embedding for the given text.
 * Uses dedicated embedding client (OpenAI / OpenRouter) - decoupled from LLM chat provider.
 * @param {string} text
 * @returns {Promise<{ embedding: number[], model: string, version: string }>}
 */
async function generateEmbedding(text) {
  const cleanText = (text || "").trim();
  if (!cleanText) {
    throw new Error("Cannot generate embedding for empty text.");
  }

  const { client, provider, model } = getEmbeddingClient();
  const targetModel = model || EMBEDDING_MODEL;

  log.info(`[Embedding] Provider: ${provider}`);
  log.info(`[Embedding] Model: ${targetModel}`);
  log.info(`[embedding] Generating embedding inputLength=${cleanText.length}`);
  const startMs = Date.now();

  try {
    const response = await client.embeddings.create({
      model: targetModel,
      input: cleanText,
    });

    const latency = Date.now() - startMs;
    const embedding = response.data[0]?.embedding;

    if (!Array.isArray(embedding) || embedding.length !== 1536) {
      throw new Error(
        `Embedding API returned invalid vector structure or dimension (expected 1536, got ${embedding?.length}).`
      );
    }

    log.info(`[embedding] Generated 1536-dim vector in ${latency}ms`);

    return {
      embedding,
      model: targetModel,
      version: EMBEDDING_VERSION,
    };
  } catch (err) {
    const safeError = err.message || "Unknown error";
    log.error(`[Embedding] Generation failed: ${safeError}`);
    throw err;
  }
}

module.exports = {
  generateEmbedding,
  EMBEDDING_MODEL,
  EMBEDDING_VERSION,
};
