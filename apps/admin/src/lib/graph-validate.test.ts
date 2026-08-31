import { describe, expect, it } from "vitest";
import type { GraphDefinition, RegistryNode } from "../api/editor";
import { validate } from "./graph-validate";

function node(key: string): RegistryNode {
  return {
    registryKey: key,
    key,
    module: key.split(".")[0] ?? "platform",
    shareable: true,
    title: key,
    description: "",
    sideEffect: null,
    inputSchema: null,
    outputSchema: null,
    configSchema: null,
    adminExposed: [],
    idempotency: null,
    execution: null,
    dependencies: [],
    persistence: null,
    fixtureNames: ["one"],
    source: "contract",
    requiresAllowlist: false,
    editorTestable: true,
  };
}

const registry = [
  "astra.requirement.quality",
  "orch.branch.decision",
  "astra.requirement.normalize",
  "human.gate",
  "astra.route.decision",
].map(node);

/** `astra.requirement.workflow` v3 — the same fixture the edit tests use. */
function astra(): GraphDefinition {
  return {
    graphKey: "astra.requirement.workflow",
    nodes: [
      { id: "quality", impl: "astra.requirement.quality" },
      { id: "branch", impl: "orch.branch.decision" },
      { id: "normalize", impl: "astra.requirement.normalize" },
      { id: "human", impl: "human.gate" },
      { id: "route", impl: "astra.route.decision" },
    ],
    edges: [
      ["__start__", "quality"],
      ["quality", "branch"],
      ["normalize", "route"],
      ["human", "route"],
      ["route", "__end__"],
    ],
    conditionalEdges: [
      {
        from: "branch",
        router: "branch_key",
        map: { pass: "normalize", human_review: "human", reject: "__end__" },
      },
    ],
  };
}

const errors = (def: GraphDefinition) =>
  validate(def, registry).filter((f) => f.level === "error");

describe("validate", () => {
  it("passes the real branching workflow", () => {
    expect(errors(astra())).toEqual([]);
  });

  it("catches an arm pointing at a step that is gone", () => {
    const def = astra();
    def.nodes = def.nodes.filter((n) => n.id !== "normalize");
    def.edges = def.edges.filter(([a, b]) => a !== "normalize" && b !== "normalize");
    const found = errors(def);
    expect(found.some((f) => f.text.includes("point nowhere"))).toBe(true);
    expect(found.some((f) => f.detail?.includes("normalize"))).toBe(true);
  });

  it("catches a step that both continues and branches", () => {
    // Exactly what inserting on an arm used to produce.
    const def = astra();
    def.edges.push(["branch", "normalize"]);
    const found = errors(def);
    expect(found.some((f) => f.text.includes("both continue and branch"))).toBe(
      true,
    );
  });

  it("catches a branch with no outcomes", () => {
    const def = astra();
    def.conditionalEdges = [{ from: "branch", router: "branch_key", map: {} }];
    // `branch` now leads nowhere, so this also strands steps — the point is
    // that the empty fork itself is named.
    const found = errors(def);
    expect(found.some((f) => f.text.includes("no outcomes"))).toBe(true);
  });
});
