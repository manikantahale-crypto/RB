const process = require('process');
const path = require('path');

// Ensure dotenv is loaded from both node-api/.env and workspace root .env
try {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
} catch {}
try {
  require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
} catch {}
try {
  require('dotenv').config();
} catch {}

const PROVIDER_PRESETS = {
  gemini: {
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai/",
    default_model: "gemini-2.0-flash",
    default_model_fast: "gemini-2.0-flash",
  },
  openai: {
    base_url: "https://api.openai.com/v1",
    default_model: "gpt-4o-mini",
    default_model_fast: "gpt-4o-mini",
  },
  openrouter: {
    base_url: "https://openrouter.ai/api/v1",
    default_model: "openai/gpt-4o-mini",
    default_model_fast: "openai/gpt-4o-mini",
  },
  groq: {
    base_url: "https://api.groq.com/openai/v1",
    default_model: "llama-3.3-70b-versatile",
    default_model_fast: "llama-3.1-8b-instant",
  },
};

function getAiConfig() {
  const provider = (process.env.AI_PROVIDER || "openrouter").trim().toLowerCase();
  const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.openrouter;

  // Resolve API key by checking provider-specific env var first, then generic fallback
  let apiKey = "";
  if (provider === "openrouter") {
    apiKey = process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY || "";
  } else if (provider === "openai") {
    apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY || "";
  } else if (provider === "gemini") {
    apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY || process.env.AI_API_KEY || "";
  } else if (provider === "groq") {
    apiKey = process.env.GROQ_API_KEY || process.env.AI_API_KEY || "";
  }

  if (!apiKey) {
    apiKey = (
      process.env.AI_API_KEY ||
      process.env.LLM_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.GROQ_API_KEY ||
      process.env.GEMINI_API_KEY ||
      ""
    ).trim();
  }

  const baseUrl = (process.env.AI_BASE_URL || preset.base_url).trim();
  const model = (process.env.AI_MODEL || process.env.OPENROUTER_MODEL || preset.default_model).trim();
  const modelFast = (process.env.AI_MODEL_FAST || preset.default_model_fast).trim();

  return {
    provider,
    apiKey: apiKey.trim(),
    baseUrl,
    model,
    modelFast,
  };
}

/**
 * Groq as the fallback chat provider. Off unless GROQ_API_KEY is set — the
 * chain in core/aiClient.js skips it and says so.
 */
function getGroqConfig() {
  const apiKey = (process.env.GROQ_API_KEY || "").trim();
  const baseUrl = (process.env.GROQ_BASE_URL || PROVIDER_PRESETS.groq.base_url).trim();
  const model = (process.env.GROQ_MODEL || "openai/gpt-oss-20b").trim();
  const modelFast = (process.env.GROQ_MODEL_FAST || "qwen/qwen3-32b").trim();
  return { provider: "groq", apiKey, baseUrl, model, modelFast, isAvailable: Boolean(apiKey) };
}

/**
 * Where embeddings come from — chosen APART from the chat provider.
 *
 * Every vector in core.embeddings is text-embedding-3-small, 1536 dims
 * (2,991 requirements, 124 resumes on 2026-09-20). Gemini's and Groq's
 * OpenAI shims do not serve that model on the embeddings route, so when the
 * chat provider is one of those, embeddings must still go to OpenAI or
 * OpenRouter — otherwise every new resume and requirement stays unembedded
 * and never enters tier 1 of matching.
 *
 *   1. AI_EMBEDDING_BASE_URL (+ AI_EMBEDDING_API_KEY / _MODEL) when set and
 *      not a Google or Groq host
 *   2. a real OPENAI_API_KEY (not an OpenRouter "sk-or-" key)
 *   3. OpenRouter, with OPENROUTER_API_KEY or AI_API_KEY
 */
function getEmbeddingConfig() {
  const model = (process.env.AI_EMBEDDING_MODEL || "text-embedding-3-small").trim();

  if (process.env.AI_EMBEDDING_BASE_URL) {
    const customUrl = process.env.AI_EMBEDDING_BASE_URL.trim();
    if (!customUrl.includes("googleapis.com") && !customUrl.includes("groq.com")) {
      return {
        provider: "custom",
        baseUrl: customUrl,
        apiKey: (process.env.AI_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY || "").trim(),
        model,
      };
    }
  }

  if (process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.startsWith("sk-or-")) {
    return {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY.trim(),
      model,
    };
  }

  return {
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: (process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY || "").trim(),
    model,
  };
}

const aiConfig = getAiConfig();

module.exports = {
  PROVIDER_PRESETS,
  aiConfig,
  getAiConfig,
  getGroqConfig,
  getEmbeddingConfig,
};
