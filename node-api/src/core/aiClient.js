/**
 * One chat completion, with somewhere to go when the provider says no.
 *
 * Ported from the deployed branch on 2026-09-20 (old_db_repo, a3daa912) —
 * this file was the 27 August version here while production had moved on
 * (ref/SYNTRA_Matching_Study.md §1). What it adds over the 57 lines it
 * replaces:
 *
 *   - a separate EMBEDDING client: embeddings need an OpenAI-compatible
 *     embeddings route, which Gemini's and Groq's OpenAI shims do not offer,
 *     so the chat provider and the embedding provider are chosen apart
 *     (config/aiConfig.js getEmbeddingConfig)
 *   - 402 / 429 / 503 classified as RETRYABLE, then a chain: reduce
 *     max_tokens once on a 402 that names what it can afford, then Groq if
 *     GROQ_API_KEY is set, then OpenRouter if OPENROUTER_API_KEY is set. On
 *     2026-09-18 a real bench-alert run hit OpenRouter 402 (no credits) and
 *     this file had nowhere to turn
 *   - `completeWithFallback` — the same, answering which provider actually
 *     spoke, so a parse can say so in its log line
 *
 * API keys are never logged; a 402 is logged as "insufficient credits".
 */
const OpenAI = require("openai");
const {
  getAiConfig,
  getGroqConfig,
  getEmbeddingConfig,
} = require("../config/aiConfig");

const log = require("../utils/logger");

function getOpenAIClient(customConfig) {
  const config = customConfig || getAiConfig();

  return new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey || "dummy-key",
    maxRetries: 0,
    defaultHeaders: {
      "HTTP-Referer": process.env.APP_URL || process.env.FRONTEND_URL || "http://localhost:3000",
      "X-Title": "Syntra ATS",
    },
  });
}

function getEmbeddingClient() {
  const embConfig = getEmbeddingConfig();

  return {
    client: new OpenAI({
      baseURL: embConfig.baseUrl,
      apiKey: embConfig.apiKey || "dummy-key",
      maxRetries: 2,
    }),
    provider: embConfig.provider,
    model: embConfig.model,
    baseUrl: embConfig.baseUrl,
  };
}

function getGroqClient() {
  const groqConfig = getGroqConfig();

  if (!groqConfig.isAvailable) return null;

  return {
    client: new OpenAI({
      baseURL: groqConfig.baseUrl,
      apiKey: groqConfig.apiKey,
      maxRetries: 2,
    }),
    model: groqConfig.model,
    modelFast: groqConfig.modelFast,
  };
}

function httpStatusOf(err) {
  return (
    err.status ||
    err.statusCode ||
    (err.message?.includes("402") ||
    err.message?.toLowerCase().includes("credits")
      ? 402
      : err.message?.includes("429")
        ? 429
        : 500)
  );
}

function isRetryableAiError(err) {
  const status = httpStatusOf(err);
  const msg = String(err.message || "").toLowerCase();
  return (
    status === 429 ||
    status === 402 ||
    status === 503 ||
    msg.includes("429") ||
    msg.includes("resource exhausted") ||
    msg.includes("rate limit") ||
    msg.includes("insufficient credits")
  );
}

function getOpenRouterClient() {
  const apiKey = (process.env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) return null;
  return {
    client: new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey,
      maxRetries: 2,
      defaultHeaders: {
        "HTTP-Referer": process.env.APP_URL || process.env.FRONTEND_URL || "http://localhost:3000",
        "X-Title": "Syntra ATS",
      },
    }),
    model: (process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini").trim(),
  };
}

function logAiChainReady(primary) {
  const groq = getGroqClient();
  const or = getOpenRouterClient();
  log.info(
    `[AI] chain primary=${primary} groq=${groq ? groq.model : "off"} openrouter=${or ? or.model : "off"}`,
  );
}

async function complete(
  prompt,
  {
    system = "",
    modelKey = "reason",
    temperature = 0.1,
    maxTokens,
    client,
    model,
    responseFormat,
    providerLabel,
    triedGroq = false,
    triedOpenRouter = false,
    triedReducedTokens = false,
    _meta,
  } = {}
) {
  const config = getAiConfig();
  const currentClient = client || getOpenAIClient();
  const activeProvider = providerLabel || config.provider;

  const modelMap = {
    reason: config.model,
    fast: config.modelFast,
  };

  const selectedModel =
    model || modelMap[modelKey] || modelKey || config.model;

  if (_meta) {
    _meta.provider = activeProvider;
    _meta.model = selectedModel;
  }

  const messages = [];

  if (system) {
    messages.push({
      role: "system",
      content: system,
    });
  }

  messages.push({
    role: "user",
    content: prompt,
  });

  const payload = {
    model: selectedModel,
    messages,
    temperature,
    max_tokens: Number(
      maxTokens || process.env.AI_MAX_TOKENS || 4096
    ),
  };

  if (responseFormat) {
    payload.response_format = responseFormat;
  }

  log.info(
    `[AI] try provider=${activeProvider} model=${selectedModel}`,
  );

  const startMs = Date.now();

  let resp;

  try {
    resp = await currentClient.chat.completions.create(payload);
  } catch (err) {
    const latency = Date.now() - startMs;
    const status = httpStatusOf(err);
    const reason =
      status === 402 ? "insufficient credits" : err.message;

    log.error(
      `[AI] FAIL provider=${activeProvider} model=${selectedModel} status=${status} duration=${latency}ms reason="${reason}"`
    );

    if (isRetryableAiError(err)) {
      if (status === 402 && !triedReducedTokens) {
        const afford = Number((err.message || "").match(/afford\s+(\d+)/i)?.[1]);
        const currentMax = Number(payload.max_tokens);
        const reduced = Math.max(256, Math.min(currentMax - 1, Number.isFinite(afford) ? afford : 512));
        if (reduced < currentMax) {
          log.warn(
            `[AI] RETRY same provider=${activeProvider} with max_tokens=${reduced} (was ${currentMax}) cause=402`,
          );
          return complete(prompt, {
            system,
            modelKey,
            temperature,
            maxTokens: reduced,
            responseFormat,
            client: currentClient,
            model: selectedModel,
            providerLabel: activeProvider,
            triedGroq,
            triedOpenRouter,
            triedReducedTokens: true,
            _meta,
          });
        }
      }
      if (!triedGroq && activeProvider !== "groq") {
        const groq = getGroqClient();
        if (groq) {
          log.warn(
            `[AI] FALLBACK from=${activeProvider} to=groq model=${groq.model} cause=${status}`,
          );
          return complete(prompt, {
            system,
            modelKey,
            temperature,
            maxTokens,
            responseFormat,
            client: groq.client,
            model: groq.model,
            providerLabel: "groq",
            triedGroq: true,
            triedOpenRouter,
            triedReducedTokens: false,
            _meta,
          });
        }
        log.warn(`[AI] FALLBACK skip groq (no GROQ_API_KEY)`);
      }
      if (!triedOpenRouter) {
        const or = getOpenRouterClient();
        if (or) {
          log.warn(
            `[AI] FALLBACK from=${activeProvider} to=openrouter model=${or.model} cause=${status}`,
          );
          return complete(prompt, {
            system,
            modelKey,
            temperature,
            maxTokens,
            responseFormat,
            client: or.client,
            model: or.model,
            providerLabel: "openrouter",
            triedGroq: true,
            triedOpenRouter: true,
            triedReducedTokens: false,
            _meta,
          });
        }
        log.warn(`[AI] FALLBACK skip openrouter (no OPENROUTER_API_KEY)`);
      }
      log.warn(
        `[AI] FALLBACK exhausted after ${activeProvider} status=${status} — no next provider`,
      );
    }

    throw err;
  }

  const latency = Date.now() - startMs;
  const tokens = resp.usage?.total_tokens || 0;
  log.info(
    `[AI] OK provider=${activeProvider} model=${selectedModel} duration=${latency}ms tokens=${tokens}`,
  );
  if (triedGroq || triedOpenRouter) {
    log.warn(
      `[AI] FALLBACK_OK winner=${activeProvider} model=${selectedModel} duration=${latency}ms`,
    );
  }

  return resp.choices[0]?.message?.content || "";
}

/**
 * Executes chat completion with the configured primary provider
 * and Groq as fallback when available.
 *
 * @param {string} prompt
 * @param {object} options
 * @returns {Promise<{ content: string, provider: string, model: string }>}
 */
async function completeWithFallback(prompt, options = {}) {
  const {
    system = "",
    modelKey = "reason",
    temperature = 0.1,
    maxTokens,
    responseFormat,
  } = options;

  const config = getAiConfig();
  logAiChainReady(config.provider);

  const meta = { provider: config.provider, model: config.model };
  const content = await complete(prompt, {
    system,
    modelKey,
    temperature,
    maxTokens,
    responseFormat,
    _meta: meta,
  });

  if (content && content.trim()) {
    return {
      content,
      provider: meta.provider,
      model: meta.model,
    };
  }

  throw new Error("LLM provider returned empty response content.");
}

module.exports = {
  getOpenAIClient,
  getEmbeddingClient,
  getGroqClient,
  complete,
  completeWithFallback,
};