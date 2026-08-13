/**
 * Defensive extraction of a JSON object from LLM text
 * (llm-graph-generator-design §8 step 5 / §7).
 *
 * Models often wrap JSON in markdown fences or add commentary.
 * We never trust the raw string — extract, parse, or fail closed.
 */

export const GENERATION_FAILED = "GENERATION_FAILED" as const;

export class GenerationFailedError extends Error {
  readonly code = GENERATION_FAILED;

  constructor(message: string, options?: { cause?: unknown }) {
    super(`${GENERATION_FAILED}: ${message}`, options);
    this.name = "GenerationFailedError";
  }
}

/**
 * Strip common markdown fences and pull the first top-level `{ ... }` block.
 */
export function extractJsonObjectText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new GenerationFailedError("LLM returned empty text");
  }

  // ```json ... ``` or ``` ... ```
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence?.[1] ?? trimmed).trim();

  const start = candidate.indexOf("{");
  if (start < 0) {
    throw new GenerationFailedError(
      "LLM response did not contain a JSON object",
    );
  }

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]!;
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
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return candidate.slice(start, i + 1);
      }
    }
  }

  throw new GenerationFailedError(
    "LLM response contained an unclosed JSON object",
  );
}

function readUnsupported(obj: Record<string, unknown>): string[] {
  const raw = obj.unsupported;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new GenerationFailedError(
      "LLM JSON field \"unsupported\" must be an array of strings",
    );
  }
  return raw
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

export type ParsedLlmGraph = {
  proposal: Record<string, unknown>;
  unsupported: string[];
};

/**
 * Parse LLM text into a graph proposal (+ optional unsupported list).
 * Throws {@link GenerationFailedError} on any failure — nothing should be stored.
 */
export function parseLlmGraphJson(raw: string): ParsedLlmGraph {
  let text: string;
  try {
    text = extractJsonObjectText(raw);
  } catch (err) {
    if (err instanceof GenerationFailedError) throw err;
    throw new GenerationFailedError("failed to extract JSON from LLM text", {
      cause: err,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new GenerationFailedError("LLM returned malformed JSON", {
      cause: err,
    });
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new GenerationFailedError(
      "LLM JSON must be an object with nodes and edges",
    );
  }

  const obj = parsed as Record<string, unknown>;
  const unsupported = readUnsupported(obj);

  // Explicit refuse path: nothing buildable.
  if (obj.error === "UNSUPPORTED_REQUEST") {
    const reason =
      typeof obj.message === "string" && obj.message.trim()
        ? obj.message.trim()
        : "This request needs tools that are not available yet.";
    const detail =
      unsupported.length > 0
        ? `${reason} Unsupported: ${unsupported.join(", ")}.`
        : reason;
    throw new GenerationFailedError(detail);
  }

  if (!("nodes" in obj) || !("edges" in obj)) {
    throw new GenerationFailedError(
      "LLM JSON missing required keys: nodes and edges",
    );
  }

  // Strip unsupported from proposal before schema validate (not part of GraphDefinition).
  const { unsupported: _u, error: _e, message: _m, ...proposal } = obj;
  return { proposal, unsupported };
}
