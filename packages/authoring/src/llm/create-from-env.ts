import type { LLMClient, LLMCompleteRequest, LLMCompleteResult } from "./types.js";
import { createFixtureLlm } from "./fixture-llm.js";

export type LlmProvider =
  | "openai"
  | "openrouter"
  | "anthropic"
  | "gemini"
  | "groq"
  | "noop";

export type LlmEnvConfig = {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  /** Optional override (e.g. OpenRouter / Azure / local gateway). */
  baseUrl?: string;
};

const OPENAI_DEFAULT_BASE = "https://api.openai.com/v1";
const OPENROUTER_DEFAULT_BASE = "https://openrouter.ai/api/v1";
const ANTHROPIC_DEFAULT_BASE = "https://api.anthropic.com/v1";
const GEMINI_DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GROQ_DEFAULT_BASE = "https://api.groq.com/openai/v1";

/**
 * Read LLM_* env. Does not throw — use {@link assertLlmConfig} / {@link createLlmClientFromEnv}.
 */
export function readLlmEnv(env: NodeJS.ProcessEnv = process.env): {
  provider?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
} {
  let provider = (env.LLM_PROVIDER ?? "").trim().toLowerCase();
  // Alias: google → gemini
  if (provider === "google") provider = "gemini";
  const apiKey = (env.LLM_API_KEY ?? "").trim();
  const model = (env.LLM_MODEL ?? "").trim();
  const baseUrl = (env.LLM_BASE_URL ?? "").trim() || undefined;
  return {
    provider: provider || undefined,
    apiKey: apiKey || undefined,
    model: model || undefined,
    baseUrl,
  };
}

export function assertLlmConfig(raw: {
  provider?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}): LlmEnvConfig {
  let provider = (raw.provider ?? "").toLowerCase();
  if (provider === "google") provider = "gemini";
  const typed = provider as LlmProvider;
  const allowed: LlmProvider[] = [
    "openai",
    "openrouter",
    "anthropic",
    "gemini",
    "groq",
    "noop",
  ];
  if (!typed || !allowed.includes(typed)) {
    throw new Error(
      `LLM_PROVIDER must be one of ${allowed.join(", ")} (got "${raw.provider ?? ""}"). ` +
        `Set LLM_PROVIDER, LLM_API_KEY, and LLM_MODEL.`,
    );
  }
  if (typed === "noop") {
    return {
      provider: "noop",
      apiKey: "",
      model: raw.model?.trim() || "noop",
      baseUrl: raw.baseUrl,
    };
  }
  if (!raw.apiKey?.trim()) {
    throw new Error(
      `LLM_API_KEY is required when LLM_PROVIDER=${typed}. ` +
        `Fail-closed: authoring LLM generate will not start without a key.`,
    );
  }
  if (!raw.model?.trim()) {
    throw new Error(
      `LLM_MODEL is required when LLM_PROVIDER=${typed}. ` +
        `Example: gpt-4o-mini, claude-sonnet-4-20250514, gemini-2.0-flash, llama-3.3-70b-versatile, openai/gpt-4o.`,
    );
  }
  return {
    provider: typed,
    apiKey: raw.apiKey.trim(),
    model: raw.model.trim(),
    baseUrl: raw.baseUrl?.trim() || undefined,
  };
}

function resolveBaseUrl(cfg: LlmEnvConfig): string {
  if (cfg.baseUrl) return cfg.baseUrl.replace(/\/$/, "");
  if (cfg.provider === "openrouter") return OPENROUTER_DEFAULT_BASE;
  if (cfg.provider === "anthropic") return ANTHROPIC_DEFAULT_BASE;
  if (cfg.provider === "gemini") return GEMINI_DEFAULT_BASE;
  if (cfg.provider === "groq") return GROQ_DEFAULT_BASE;
  return OPENAI_DEFAULT_BASE;
}

/** OpenAI-compatible chat completions (also OpenRouter). */
function createOpenAiCompatibleClient(cfg: LlmEnvConfig): LLMClient {
  const base = resolveBaseUrl(cfg);
  return {
    async complete(req: LLMCompleteRequest): Promise<LLMCompleteResult> {
      const model = req.model ?? cfg.model;
      const temperature = req.temperature ?? 0.2;
      const body: Record<string, unknown> = {
        model,
        temperature,
        max_tokens: req.maxTokens ?? 4096,
        messages: [
          ...(req.system
            ? [{ role: "system" as const, content: req.system }]
            : []),
          { role: "user" as const, content: req.prompt },
        ],
      };
      if (req.responseJsonSchema) {
        body.response_format = {
          type: "json_schema",
          json_schema: {
            name: "workflow_graph",
            strict: true,
            schema: req.responseJsonSchema,
          },
        };
      }
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      };
      if (cfg.provider === "openrouter") {
        headers["HTTP-Referer"] = "https://tekisho.local";
        headers["X-Title"] = "Tekisho Authoring";
      }
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `LLM ${cfg.provider} HTTP ${res.status}: ${text.slice(0, 500)}`,
        );
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      };
      const text = json.choices?.[0]?.message?.content ?? "";
      return {
        text,
        model: json.model ?? model,
        usage: {
          promptTokens: json.usage?.prompt_tokens ?? 0,
          completionTokens: json.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}

/** Anthropic Messages API. */
function createAnthropicClient(cfg: LlmEnvConfig): LLMClient {
  const base = resolveBaseUrl(cfg);
  return {
    async complete(req: LLMCompleteRequest): Promise<LLMCompleteResult> {
      const model = req.model ?? cfg.model;
      const temperature = req.temperature ?? 0.2;
      const res = await fetch(`${base}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: req.maxTokens ?? 4096,
          temperature,
          system: req.system,
          messages: [{ role: "user", content: req.prompt }],
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `LLM anthropic HTTP ${res.status}: ${text.slice(0, 500)}`,
        );
      }
      const json = (await res.json()) as {
        content?: Array<{ type?: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
        model?: string;
      };
      const text =
        json.content
          ?.filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("") ?? "";
      return {
        text,
        model: json.model ?? model,
        usage: {
          promptTokens: json.usage?.input_tokens ?? 0,
          completionTokens: json.usage?.output_tokens ?? 0,
        },
      };
    },
  };
}

/**
 * Google Gemini generateContent API (AI Studio / Generative Language).
 * Key via x-goog-api-key header. Alias LLM_PROVIDER=google → gemini.
 */
function createGeminiClient(cfg: LlmEnvConfig): LLMClient {
  const base = resolveBaseUrl(cfg);
  return {
    async complete(req: LLMCompleteRequest): Promise<LLMCompleteResult> {
      const model = req.model ?? cfg.model;
      const temperature = req.temperature ?? 0.2;
      // 2.5 Flash "thinking" can burn the whole budget before JSON finishes —
      // force JSON + zero thinking, and allow enough output tokens.
      const maxOut = req.maxTokens ?? 4096;
      const url = `${base}/models/${encodeURIComponent(model)}:generateContent`;
      const body: Record<string, unknown> = {
        contents: [
          {
            role: "user",
            parts: [{ text: req.prompt }],
          },
        ],
        generationConfig: {
          temperature,
          maxOutputTokens: maxOut,
          responseMimeType: "application/json",
          ...(req.responseJsonSchema
            ? { responseSchema: toGeminiSchema(req.responseJsonSchema) }
            : {}),
          thinkingConfig: { thinkingBudget: 0 },
        },
      };
      if (req.system?.trim()) {
        body.systemInstruction = {
          parts: [{ text: req.system }],
        };
      }
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": cfg.apiKey,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        // Older models may reject thinkingConfig / responseMimeType — retry stripped.
        if (
          res.status === 400 &&
          (text.includes("thinkingConfig") ||
            text.includes("responseMimeType") ||
            text.includes("Unknown name"))
        ) {
          return completeGeminiLegacy(cfg, req, base, model, temperature, maxOut);
        }
        throw new Error(
          `LLM gemini HTTP ${res.status}: ${text.slice(0, 500)}`,
        );
      }
      const json = (await res.json()) as GeminiGenerateResponse;
      const finish = json.candidates?.[0]?.finishReason;
      const text = extractGeminiText(json);
      if (!text.trim()) {
        throw new Error("Gemini returned empty text");
      }
      if (finish === "MAX_TOKENS" && looksTruncatedJson(text)) {
        throw new Error(
          "Gemini ran out of output tokens mid-response (raise LLM max tokens or disable thinking). Try again.",
        );
      }
      return {
        text,
        model: json.modelVersion ?? model,
        usage: {
          promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
          completionTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    },
  };
}

type GeminiGenerateResponse = {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{ text?: string; thought?: boolean }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  modelVersion?: string;
};

function extractGeminiText(json: GeminiGenerateResponse): string {
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  // Skip "thought" parts from thinking models — we only want the answer JSON.
  return parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? "")
    .join("");
}

function looksTruncatedJson(text: string): boolean {
  const t = text.trim();
  if (!t.includes("{")) return false;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (const ch of t) {
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return depth !== 0;
}

/** Fallback when the model rejects JSON-mode / thinkingConfig fields. */
/**
 * Translate a strict JSON Schema into the subset Gemini's `responseSchema`
 * accepts.
 *
 * WHY THIS EXISTS. The schema we send is written for OpenAI structured
 * outputs, which REQUIRE `additionalProperties: false` and accept union types
 * like `["string", "null"]`. Gemini accepts neither, and answers 400 with
 * `Unknown name "additionalProperties"`. That 400 used to drop the request
 * into `completeGeminiLegacy`, which sends no schema at all — so the strict
 * schema silently became no schema, and every claim about constrained output
 * was false on this provider.
 *
 * The knock-on was worse than the lost constraint. Legacy also drops
 * `thinkingConfig: { thinkingBudget: 0 }`, and on the 2.5 models thinking
 * tokens are charged against `maxOutputTokens` — so the model spent its budget
 * thinking and the JSON came back truncated mid-object. The symptom was
 * "LLM response contained an unclosed JSON object", three levels away from
 * the cause.
 *
 * Whitelist rather than blacklist: an unknown keyword is a 400, and a 400 is
 * how this whole failure started.
 */
const GEMINI_SCHEMA_KEYS = new Set([
  "type",
  "format",
  "description",
  "nullable",
  "enum",
  "items",
  "properties",
  "required",
  "minItems",
  "maxItems",
  "propertyOrdering",
]);

export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;

  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(src)) {
    if (!GEMINI_SCHEMA_KEYS.has(key)) continue;

    if (key === "type" && Array.isArray(value)) {
      // ["string", "null"] → type: "string", nullable: true
      const types = value.filter((t) => t !== "null");
      if (value.includes("null")) out.nullable = true;
      out.type = types[0] ?? "string";
      continue;
    }
    if (key === "properties" && value && typeof value === "object") {
      const props: Record<string, unknown> = {};
      for (const [name, sub] of Object.entries(value as Record<string, unknown>)) {
        props[name] = toGeminiSchema(sub);
      }
      out.properties = props;
      continue;
    }
    if (key === "items") {
      out.items = toGeminiSchema(value);
      continue;
    }
    out[key] = value;
  }

  return out;
}

async function completeGeminiLegacy(
  cfg: LlmEnvConfig,
  req: LLMCompleteRequest,
  base: string,
  model: string,
  temperature: number,
  maxOut: number,
): Promise<LLMCompleteResult> {
  const url = `${base}/models/${encodeURIComponent(model)}:generateContent`;
  const body: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts: [{ text: req.prompt }],
      },
    ],
    generationConfig: {
      temperature,
      maxOutputTokens: maxOut,
    },
  };
  if (req.system?.trim()) {
    body.systemInstruction = {
      parts: [{ text: req.system }],
    };
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": cfg.apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM gemini HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = (await res.json()) as GeminiGenerateResponse;
  return {
    text: extractGeminiText(json),
    model: json.modelVersion ?? model,
    usage: {
      promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

export function createLlmClient(cfg: LlmEnvConfig): LLMClient {
  if (cfg.provider === "noop") {
    // Deterministic English → graph for local dev + smoke tests (no API key).
    return createFixtureLlm();
  }
  if (cfg.provider === "anthropic") {
    return createAnthropicClient(cfg);
  }
  if (cfg.provider === "gemini") {
    return createGeminiClient(cfg);
  }
  return createOpenAiCompatibleClient(cfg);
}

/**
 * Build client from process env. Throws with a clear message if misconfigured
 * (except LLM_PROVIDER=noop). Call at admin-api startup / generate wiring.
 */
export function createLlmClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LLMClient {
  const cfg = assertLlmConfig(readLlmEnv(env));
  return createLlmClient(cfg);
}
