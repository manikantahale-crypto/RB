import { describe, expect, it } from "vitest";
import type { GraphDefinition } from "../api/editor";
import { insertOnEdge, nextStepId, removeStep } from "./graph-edit";

/**
 * The real branching workflow — `astra.requirement.workflow` v3, copied from
 * V24__astra_workflow_v3_branch.sql. A synthetic fixture would not have the
 * thing that actually breaks: an arm (`reject`) that terminates the workflow.
 */
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

const armsOf = (d: GraphDefinition) => d.conditionalEdges?.[0]?.map ?? {};
const plainFrom = (d: GraphDefinition, id: string) =>
  d.edges.filter(([a]) => a === id);

describe("nextStepId", () => {
  it("derives an id from the node key and keeps it unique", () => {
    const d = astra();
    expect(nextStepId(d, "syntra.match.process")).toBe("process");
    expect(nextStepId(d, "astra.requirement.quality")).toBe("quality2");
  });
});

describe("insertOnEdge", () => {
  it("splits a plain edge and leaves the arms untouched", () => {
    const before = astra();
    const { def, newNodeId } = insertOnEdge(
      before,
      { kind: "plain", from: "quality", to: "branch" },
      "syntra.match.process",
    );
    expect(def.edges).toContainEqual(["quality", newNodeId]);
    expect(def.edges).toContainEqual([newNodeId, "branch"]);
    expect(def.edges).not.toContainEqual(["quality", "branch"]);
    expect(armsOf(def)).toEqual(armsOf(before));
  });

  it("repoints the arm and gives the branch NO plain edge", () => {
    // The regression that matters: a plain edge out of `branch` alongside its
    // arms means both fire at runtime.
    const { def, newNodeId } = insertOnEdge(
      astra(),
      { kind: "conditional", from: "branch", label: "pass", to: "normalize" },
      "syntra.match.process",
    );
    expect(armsOf(def).pass).toBe(newNodeId);
    expect(plainFrom(def, "branch")).toEqual([]);
  });

  it("does not bypass the step it just inserted on an arm", () => {
    const { def, newNodeId } = insertOnEdge(
      astra(),
      { kind: "conditional", from: "branch", label: "pass", to: "normalize" },
      "syntra.match.process",
    );
    expect(def.edges).toContainEqual([newNodeId, "normalize"]);
    expect(armsOf(def).human_review).toBe("human");
    expect(armsOf(def).reject).toBe("__end__");
  });

  it("inserts on an arm that ends the workflow", () => {
    const { def, newNodeId } = insertOnEdge(
      astra(),
      { kind: "conditional", from: "branch", label: "reject", to: "__end__" },
      "syntra.notify.send",
    );
    expect(armsOf(def).reject).toBe(newNodeId);
    expect(def.edges).toContainEqual([newNodeId, "__end__"]);
    expect(plainFrom(def, "branch")).toEqual([]);
  });
});

describe("removeStep", () => {
  it("repoints an arm at what the removed step led to", () => {
    const def = removeStep(astra(), "normalize");
    expect(armsOf(def).pass).toBe("route");
    expect(def.nodes.some((n) => n.id === "normalize")).toBe(false);
    // No arm may point at a step that is gone — this is what the server
    // rejects with DEFINITION_INVALID today.
    const ids = new Set(def.nodes.map((n) => n.id));
    for (const t of Object.values(armsOf(def))) {
      expect(t === "__end__" || ids.has(t)).toBe(true);
    }
  });

  it("falls back to __end__ when the removed step led nowhere", () => {
    const def = removeStep(removeStep(astra(), "route"), "normalize");
    expect(armsOf(def).pass).toBe("__end__");
  });

  it("takes the arms with the decision and reconnects the first one", () => {
    const def = removeStep(astra(), "branch");
    expect(def.conditionalEdges).toBeUndefined();
    // `quality` led into the decision; it must still lead somewhere.
    expect(def.edges).toContainEqual(["quality", "normalize"]);
    // Exactly one — several plain edges out of `quality` would all fire.
    expect(plainFrom(def, "quality")).toHaveLength(1);
  });

  it("heals a plain chain as before", () => {
    const def = removeStep(astra(), "route");
    expect(def.edges).toContainEqual(["normalize", "__end__"]);
    expect(def.edges).toContainEqual(["human", "__end__"]);
    expect(def.edges.some(([a, b]) => a === "route" || b === "route")).toBe(
      false,
    );
  });
});
