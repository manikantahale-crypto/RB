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
    apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY || "";
  } else if (provider === "groq") {
    apiKey = process.env.GROQ_API_KEY || process.env.AI_API_KEY || "";
  }

  if (!apiKey) {
    apiKey = (
      process.env.AI_API_KEY ||
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

const aiConfig = getAiConfig();

module.exports = {
  PROVIDER_PRESETS,
  aiConfig,
  getAiConfig,
};
