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

  it("catches a path the decision can never return", () => {
    // Renaming an arm without moving its band leaves an edge nothing takes.
    const def = astra();
    def.conditionalEdges = [
      {
        from: "branch",
        router: "branch_key",
        map: { pass: "normalize", escalate: "human", reject: "__end__" },
      },
    ];
    const found = errors(def);
    expect(found.some((f) => f.text.includes("nothing can ever take"))).toBe(true);
    expect(found.some((f) => f.detail?.includes("escalate"))).toBe(true);
  });

  it("accepts a path the decision was configured to return", () => {
    const def = astra();
    def.nodes = def.nodes.map((n) =>
      n.id === "branch"
        ? {
            ...n,
            config: {
              outcomes: [
                { name: "pass", min: 0.6 },
                { name: "escalate", min: 0.3 },
                { name: "reject", min: 0 },
              ],
            },
          }
        : n,
    );
    def.conditionalEdges = [
      {
        from: "branch",
        router: "branch_key",
        map: { pass: "normalize", escalate: "human", reject: "__end__" },
      },
    ];
    expect(
      errors(def).some((f) => f.text.includes("nothing can ever take")),
    ).toBe(false);
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

describe("can every step get what it needs", () => {
  /** node_registry says match.process requires resumeId. */
  const withRequired = [
    ...registry,
    { ...node("syntra.match.process"), inputSchema: { required: ["resumeId"] } },
  ];
  const oneStep = (inputs?: Record<string, string>): GraphDefinition => ({
    graphKey: "syntra.authored",
    nodes: [{ id: "match", impl: "syntra.match.process", ...(inputs ? { inputs } : {}) }],
    edges: [
      ["__start__", "match"],
      ["match", "__end__"],
    ],
  });
  const run = (
    def: GraphDefinition,
    trigger?: { fields: string[]; declared: boolean },
  ) => validate(def, withRequired, trigger);

  it("says it could not check when nothing was supplied", () => {
    const f = run(oneStep());
    expect(f.some((x) => x.text === "Inputs not checked")).toBe(true);
  });

  it("says it could not check when the trigger describes nothing", () => {
    // Eight event schemas hold a placeholder written at boot. Reading those as
    // "carries nothing" would blame the workflow for a catalogue gap.
    const f = run(oneStep(), { fields: [], declared: false });
    expect(f.some((x) => x.text.includes("does not describe itself"))).toBe(true);
    expect(f.some((x) => x.level === "error")).toBe(false);
  });

  it("blocks a step whose required field nothing provides", () => {
    const f = run(oneStep(), { fields: ["jobId"], declared: true });
    const err = f.find((x) => x.level === "error");
    expect(err?.text).toContain("cannot get what they need");
    expect(err?.detail).toContain("match needs resumeId");
  });

  it("passes when the trigger carries it", () => {
    const f = run(oneStep(), { fields: ["jobId", "resumeId"], declared: true });
    expect(f.some((x) => x.text === "Every step can get what it needs")).toBe(true);
  });

  it("passes when the step maps it from somewhere", () => {
    // A step receives the trigger payload with its map merged on top.
    const f = run(oneStep({ resumeId: "trigger.cvId" }), {
      fields: ["cvId"],
      declared: true,
    });
    expect(f.some((x) => x.level === "error")).toBe(false);
  });
});
