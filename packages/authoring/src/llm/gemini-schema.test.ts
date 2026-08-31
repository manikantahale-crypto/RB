/**
 * Gemini rejects the schema we send to OpenAI, and the way it failed was worse
 * than the failure.
 *
 * The strict schema carries `additionalProperties: false` (required by OpenAI
 * structured outputs) and `type: ["string", "null"]`. Gemini answers HTTP 400
 * on both. That 400 was caught and retried WITHOUT any schema at all, so the
 * "constrained output" guarantee silently became unconstrained output — and
 * the retry also dropped `thinkingConfig: { thinkingBudget: 0 }`, letting
 * thinking tokens eat `maxOutputTokens` until the JSON came back truncated.
 *
 * The reported symptom was "LLM response contained an unclosed JSON object",
 * three layers from the cause. These tests pin the translation so it stays
 * fixed.
 */
import { describe, expect, it } from "vitest";
import { toGeminiSchema } from "./create-from-env.js";
import { buildLlmGraphJsonSchema } from "../llm-graph-proposal-schema.js";

/** Every key Gemini's responseSchema will reject, anywhere in the tree. */
function offendingKeys(node: unknown, path = "$"): string[] {
  if (Array.isArray(node)) return node.flatMap((n, i) => offendingKeys(n, `${path}[${i}]`));
  if (!node || typeof node !== "object") return [];
  const allowed = new Set([
    "type", "format", "description", "nullable", "enum",
    "items", "properties", "required", "minItems", "maxItems", "propertyOrdering",
  ]);
  const out: string[] = [];
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (!allowed.has(k)) out.push(`${path}.${k}`);
    if (k === "properties" && v && typeof v === "object") {
      for (const [name, sub] of Object.entries(v as Record<string, unknown>)) {
        out.push(...offendingKeys(sub, `${path}.${name}`));
      }
    } else if (k === "items") {
      out.push(...offendingKeys(v, `${path}[]`));
    }
  }
  return out;
}

describe("toGeminiSchema", () => {
  it("removes every key Gemini would 400 on, at any depth", () => {
    const translated = toGeminiSchema(buildLlmGraphJsonSchema());
    expect(offendingKeys(translated)).toEqual([]);
  });

  it("turns a nullable union into type + nullable", () => {
    const out = toGeminiSchema({ type: ["string", "null"] }) as Record<string, unknown>;
    expect(out).toEqual({ type: "string", nullable: true });
  });

  it("leaves a plain type alone", () => {
    expect(toGeminiSchema({ type: "string" })).toEqual({ type: "string" });
  });

  it("KEEPS enum — it is the whole point", () => {
    // If the enum is dropped, the model can invent node keys and the only
    // remaining defence is Zod downstream. That fails closed, but it fails —
    // burning a retry and often the whole generation.
    const translated = toGeminiSchema(buildLlmGraphJsonSchema()) as any;
    const toolKey = translated.properties.nodes.items.properties.toolKey;
    expect(Array.isArray(toolKey.enum)).toBe(true);
    expect(toolKey.enum.length).toBeGreaterThan(0);
    expect(toolKey.enum).toContain("syntra.jd.process");
  });

  it("keeps required and nested structure intact", () => {
    const translated = toGeminiSchema(buildLlmGraphJsonSchema()) as any;
    expect(translated.required).toEqual(["nodes", "edges", "unsupported"]);
    expect(translated.properties.edges.items.properties.label).toEqual({
      type: "string",
      nullable: true,
    });
  });
});
