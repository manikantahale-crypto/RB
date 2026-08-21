const { getOpenAIClient } = require("../core/aiClient");
const log = require("../utils/logger");

const EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL || "text-embedding-3-small";
const EMBEDDING_VERSION = "v1";

/**
 * Generate 1536-dimensional vector embedding for the given text.
 * @param {string} text
 * @returns {Promise<{ embedding: number[], model: string, version: string }>}
 */
async function generateEmbedding(text) {
  const cleanText = (text || "").trim();
  if (!cleanText) {
    throw new Error("Cannot generate embedding for empty text.");
  }

  log.info(`[embedding] Generating embedding using model=${EMBEDDING_MODEL} inputLength=${cleanText.length}`);
  const startMs = Date.now();

  const client = getOpenAIClient();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
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
    model: EMBEDDING_MODEL,
    version: EMBEDDING_VERSION,
  };
}

module.exports = {
  generateEmbedding,
  EMBEDDING_MODEL,
  EMBEDDING_VERSION,
};
