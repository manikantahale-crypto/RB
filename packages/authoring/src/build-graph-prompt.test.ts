/**
 * The prompt is scoped to one application, and these pin the two ways that
 * used to fail.
 *
 * Both failures were silent. A model offered another application's tools will
 * cheerfully use them, and the graph it returns validates — every key is real —
 * so nothing downstream objects. It just cannot route: one run, one version
 * pin, two owners. And a prompt that shows ten tools while its rules enumerate
 * twenty-two is a prompt that contradicts itself, which is the other way the
 * model ends up reaching for a node it was not given.
 */
import { describe, expect, it } from "vitest";
import { buildGraphSystemPrompt } from "./build-graph-prompt.js";
import { getToolCatalog } from "./tool-registry.js";
import { buildLlmGraphJsonSchema } from "./llm-graph-proposal-schema.js";
import { isTransientProviderError } from "./parse-llm-graph.js";

const catalog = getToolCatalog();
const syntraPalette = catalog.filter(
  (t) => t.key.startsWith("syntra.") || t.key === "human.gate" || t.key === "orch.branch.decision",
);

const prompt = (tools?: readonly (typeof catalog)[number][]) =>
  buildGraphSystemPrompt({ events: [], ...(tools ? { tools } : {}) });

describe("the tool catalogue in the prompt", () => {
  it("offers everything when no scope is given", () => {
    // The other callers — the agents route, generation-meta — still rely on
    // this, so scoping has to be opt-in.
    const p = prompt();
    expect(p).toContain("syntra.match.process");
    expect(p).toContain("astra.requirement.quality");
  });

  it("offers no foreign application's tools when scoped", () => {
    const p = prompt(syntraPalette);
    expect(p).toContain("syntra.match.process");
    expect(p).not.toContain("astra.requirement.quality");
    expect(p).not.toContain("astra.route.decision");
    expect(p).not.toContain("orbit.");
  });

  it("still offers shared platform capability when scoped", () => {
    // Scoping must not cost an author the ability to branch or ask a person.
    const p = prompt(syntraPalette);
    expect(p).toContain("human.gate");
    expect(p).toContain("orch.branch.decision");
  });
});

describe("the rules agree with the catalogue", () => {
  it("permits exactly the keys it showed", () => {
    const p = prompt(syntraPalette);
    const line = p
      .split("\n")
      .find((l) => l.includes("Every node.toolKey MUST be exactly one of"))!;
    expect(line).toBeDefined();
    expect(line).toContain("syntra.match.process");
    // The whole point: the allowed list is the scoped list, not all 22.
    expect(line).not.toContain("astra.requirement.quality");
  });

  it("drops rules that instruct the model to use a tool it does not have", () => {
    const p = prompt(syntraPalette);
    // This rule names four ASTRA tools and tells the model to build with them.
    expect(p).not.toContain("For ASTRA intake quality gates");
  });

  it("keeps rules whose tools are in scope", () => {
    const p = prompt(syntraPalette);
    expect(p).toContain("node.config.hardFilters on syntra.match.process");
    expect(p).toContain("Duplicate review canonical shape");
  });

  it("never claims another application's tools are shared", () => {
    // The line that contradicted node_registry and produced mixed graphs.
    for (const p of [prompt(), prompt(syntraPalette)]) {
      expect(p).not.toContain("are shared platform tools");
    }
  });

  it("lets a request span applications, and asks for the right order", () => {
    // This rule once said a workflow belongs to ONE application and to stop at
    // the handoff — right about storage, wrong about authoring. A description
    // spanning two applications got half an answer. The graph is split into a
    // chain after generation, so the model's job is the ORDER.
    const p = prompt(syntraPalette);
    expect(p).toContain("A request may span applications");
    expect(p).toContain("the order the work actually flows");
    expect(p).not.toContain("belongs to ONE application");
  });
});

describe("an ASTRA author", () => {
  const astraPalette = catalog.filter(
    (t) => t.key.startsWith("astra.") || t.key === "orch.branch.decision",
  );

  it("gets ASTRA's intake rule and none of SYNTRA's matching rules", () => {
    const p = prompt(astraPalette);
    expect(p).toContain("For ASTRA intake quality gates");
    expect(p).not.toContain("node.config.hardFilters");
    expect(p).not.toContain("syntra.match.process");
  });

  it("is told to stop at the handoff event rather than continue past it", () => {
    const p = prompt(astraPalette);
    expect(p).toContain("STOP THERE");
  });
});

describe("the catalogue comes from the contracts, not the prose", () => {
  /** Shaped as node_registry stores it. */
  const nodes = [
    {
      key: "syntra.match.process",
      title: "Score a match",
      description: "Score a job against a resume.",
      module: "syntra",
      sideEffect: "internal_write",
      input: {
        type: "object",
        required: ["resumeId"],
        properties: {
          jobId: { type: "string" },
          resumeId: { type: "string" },
          requirement_id: { type: "string" },
        },
      },
      output: { type: "object", properties: { status: { type: "string" } } },
      config: {
        type: "object",
        properties: {
          matchThreshold: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  ];

  it("describes the node from its schema when given registry rows", () => {
    const p = buildGraphSystemPrompt({ events: [], nodes });
    expect(p).toContain("requirement_id");
    expect(p).toContain("resumeId: string, required");
  });

  it("scopes the allowed keys to the nodes it was given", () => {
    const p = buildGraphSystemPrompt({ events: [], nodes });
    const line = /Every node\.toolKey MUST be exactly one of: (.*)\./.exec(p)?.[1];
    expect(line).toContain("syntra.match.process");
    expect(line).not.toContain("astra.");
  });

  it("no longer states a threshold scale the schema contradicts", () => {
    // The rules said 0–100 while the contract declares 0–1. Harmless when the
    // model had nothing to compare against; a contradiction now that the
    // catalogue prints the real range a few lines above.
    const p = buildGraphSystemPrompt({ events: [], nodes });
    expect(p).toContain("matchThreshold: number 0–1");
    expect(p).not.toContain("matchThreshold (0–100)");
    expect(p).not.toContain('"matchThreshold": 80');
  });

  it("still falls back to the prose catalogue when no rows are given", () => {
    // agents.ts and generation-meta.ts have nothing better to pass.
    const p = buildGraphSystemPrompt({ events: [] });
    expect(p).toContain("syntra.match.process");
  });
});

describe("the schema the provider enforces", () => {
  it("offers only the scoped keys, not every node in the system", () => {
    // The bug this pins: structured output constrains the decoder to the enum,
    // so an enum listing all 22 told the model they were legal however firmly
    // the prose said eleven. A SYNTRA author's workflow came back with ASTRA
    // steps in it.
    const scoped = ["syntra.match.process", "human.gate"];
    const schema = buildLlmGraphJsonSchema(scoped) as any;
    const enumKeys = schema.properties.nodes.items.properties.toolKey.enum;
    expect(enumKeys).toEqual(scoped);
    expect(enumKeys.some((k: string) => k.startsWith("astra."))).toBe(false);
  });

  it("falls back to every key when no scope is given", () => {
    const schema = buildLlmGraphJsonSchema() as any;
    expect(
      schema.properties.nodes.items.properties.toolKey.enum.length,
    ).toBeGreaterThan(2);
  });
});

describe("telling a busy provider from a bad request", () => {
  it("treats a rate limit as worth waiting for", () => {
    // The real one: Gemini answers 429 with a quota message and a docs URL.
    // Retrying works; rewriting the description does not.
    for (const msg of [
      "LLM gemini HTTP 429: You exceeded your current quota",
      "RESOURCE_EXHAUSTED",
      "the model is overloaded",
      "HTTP 503 Service Unavailable",
      "fetch failed",
      "ETIMEDOUT",
    ]) {
      expect(isTransientProviderError(new Error(msg))).toBe(true);
    }
  });

  it("does not retry a request that will fail the same way again", () => {
    for (const msg of [
      "UNSUPPORTED_REQUEST: nothing could be built",
      "LLM returned malformed JSON",
      'unknown toolKey "syntra.magic.match" on node "match"',
    ]) {
      expect(isTransientProviderError(new Error(msg))).toBe(false);
    }
  });
});
