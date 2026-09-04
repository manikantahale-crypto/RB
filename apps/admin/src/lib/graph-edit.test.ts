import { describe, expect, it } from "vitest";
import type { GraphDefinition } from "../api/editor";
import {
  ROUTERS,
  addArm,
  addBranch,
  forkAt,
  insertOnEdge,
  nextStepId,
  readBands,
  removeArm,
  removeStep,
  renameArm,
  setArmTarget,
  setArmThreshold,
  whyNoBranch,
  whyNotArmName,
} from "./graph-edit";

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

/* ─────────────────────────────── branching ─────────────────────────────── */

const byKey = (k: string) => ROUTERS.find((r) => r.key === k)!;
const scored = byKey("branch_key");
const onResult = byKey("result.approved_or_end");

/** A plain three-step chain, before anyone branches it. */
function linear(): GraphDefinition {
  return {
    graphKey: "syntra.match.workflow",
    nodes: [
      { id: "parse", impl: "syntra.jd.process" },
      { id: "match", impl: "syntra.match.process" },
      { id: "notify", impl: "syntra.shortlist.notify" },
    ],
    edges: [
      ["__start__", "parse"],
      ["parse", "match"],
      ["match", "notify"],
      ["notify", "__end__"],
    ],
  };
}

describe("addBranch — a decision that is its own step", () => {
  it("inserts the decision and forks it, with no plain edge out", () => {
    const { def, newNodeId } = addBranch(
      linear(),
      { kind: "plain", from: "match", to: "notify" },
      scored,
    );
    expect(newNodeId).toBe("decision");
    expect(def.nodes.some((n) => n.impl === "orch.branch.decision")).toBe(true);
    expect(def.edges).toContainEqual(["match", "decision"]);
    // The corruption this whole module exists to prevent.
    expect(plainFrom(def, "decision")).toEqual([]);
  });

  it("keeps the path that already worked, and stubs the rest", () => {
    const { def, newNodeId } = addBranch(
      linear(),
      { kind: "plain", from: "match", to: "notify" },
      scored,
    );
    const fork = forkAt(def, newNodeId!)!;
    expect(fork.router).toBe("branch_key");
    expect(fork.map).toEqual({
      pass: "notify",
      human_review: "__end__",
      reject: "__end__",
    });
  });

  it("freezes no thresholds the author never chose", () => {
    // The decision's settings are declared on its node contract, so the panel
    // projects them with their own defaults and the runtime falls back to the
    // same values. Stamping them into the definition here would freeze a
    // number nobody picked into a published version.
    const { def, newNodeId } = addBranch(
      linear(),
      { kind: "plain", from: "match", to: "notify" },
      scored,
    );
    const node = def.nodes.find((n) => n.id === newNodeId)!;
    expect(node.config).toEqual({});
    expect(node.impl).toBe("orch.branch.decision");
  });

  it("can be added on an existing branch arm", () => {
    const first = addBranch(
      linear(),
      { kind: "plain", from: "match", to: "notify" },
      scored,
    ).def;
    const { def, newNodeId } = addBranch(
      first,
      { kind: "conditional", from: "decision", label: "pass", to: "notify" },
      scored,
    );
    // The incoming arm now points at the new decision, not past it.
    expect(forkAt(def, "decision")!.map.pass).toBe(newNodeId);
    expect(plainFrom(def, "decision")).toEqual([]);
    expect(plainFrom(def, newNodeId!)).toEqual([]);
  });
});

describe("addBranch — a fork that reads the previous step's result", () => {
  it("adds no step and hangs the fork off the step that is already there", () => {
    const { def, newNodeId } = addBranch(
      linear(),
      { kind: "plain", from: "match", to: "notify" },
      onResult,
    );
    expect(newNodeId).toBeNull();
    expect(def.nodes).toHaveLength(3);
    expect(plainFrom(def, "match")).toEqual([]);
    expect(forkAt(def, "match")!.map).toEqual({
      approved: "notify",
      rejected: "__end__",
    });
  });
});

describe("whyNoBranch", () => {
  it("refuses to start a workflow with a branch", () => {
    const why = whyNoBranch(
      linear(),
      { kind: "plain", from: "__start__", to: "parse" },
      onResult,
    );
    expect(why).toMatch(/cannot begin with a branch/);
  });

  it("refuses a second fork on the same step", () => {
    const once = addBranch(
      linear(),
      { kind: "plain", from: "match", to: "notify" },
      onResult,
    ).def;
    expect(
      whyNoBranch(once, { kind: "plain", from: "match", to: "notify" }, onResult),
    ).toMatch(/already branches/);
  });

  it("allows a decision step at the start, since it brings its own step", () => {
    // The decision is inserted BETWEEN start and the first step, so the
    // workflow still begins with a step rather than a fork.
    expect(
      whyNoBranch(
        linear(),
        { kind: "plain", from: "__start__", to: "parse" },
        scored,
      ),
    ).toBeNull();
  });

  it("allows an ordinary branch", () => {
    expect(
      whyNoBranch(
        linear(),
        { kind: "plain", from: "match", to: "notify" },
        onResult,
      ),
    ).toBeNull();
  });
});

describe("setArmTarget", () => {
  it("points one outcome somewhere else and leaves the others alone", () => {
    const { def } = addBranch(
      linear(),
      { kind: "plain", from: "match", to: "notify" },
      scored,
    );
    const moved = setArmTarget(def, "decision", "human_review", "notify");
    expect(forkAt(moved, "decision")!.map).toEqual({
      pass: "notify",
      human_review: "notify",
      reject: "__end__",
    });
  });
});

describe("a branch survives the edits around it", () => {
  it("removing the decision takes its arms and reconnects the chain", () => {
    const { def } = addBranch(
      linear(),
      { kind: "plain", from: "match", to: "notify" },
      scored,
    );
    const after = removeStep(def, "decision");
    expect(after.conditionalEdges).toBeUndefined();
    expect(after.edges).toContainEqual(["match", "notify"]);
  });

  it("inserting a step on an arm keeps the fork intact", () => {
    const { def } = addBranch(
      linear(),
      { kind: "plain", from: "match", to: "notify" },
      scored,
    );
    const { def: after, newNodeId } = insertOnEdge(
      def,
      { kind: "conditional", from: "decision", label: "pass", to: "notify" },
      "syntra.duplicate.merge",
    );
    expect(forkAt(after, "decision")!.map.pass).toBe(newNodeId);
    expect(after.edges).toContainEqual([newNodeId, "notify"]);
    expect(plainFrom(after, "decision")).toEqual([]);
  });
});

/* ─────────────────────── adding and naming paths ───────────────────────── */

/** A graph with a score branch already on it. */
function branched() {
  return addBranch(
    linear(),
    { kind: "plain", from: "match", to: "notify" },
    scored,
  ).def;
}

const bandsOf = (d: GraphDefinition) =>
  readBands(d.nodes.find((n) => n.id === "decision"))!;

describe("whyNotArmName", () => {
  const fork = () => forkAt(branched(), "decision")!;

  it("refuses a name the runtime could not return", () => {
    expect(whyNotArmName(fork(), "Needs Review")).toMatch(/Lowercase/);
    expect(whyNotArmName(fork(), "2nd")).toMatch(/Lowercase/);
    expect(whyNotArmName(fork(), "")).toMatch(/Give the path a name/);
  });

  it("refuses a duplicate, which would silently replace the other path", () => {
    expect(whyNotArmName(fork(), "pass")).toMatch(/already has a pass path/);
  });

  it("allows renaming a path to itself", () => {
    expect(whyNotArmName(fork(), "pass", "pass")).toBeNull();
  });

  it("allows a sensible new name", () => {
    expect(whyNotArmName(fork(), "escalate")).toBeNull();
  });
});

describe("addArm", () => {
  it("adds the path and a band that can actually reach it", () => {
    // The failure this prevents: an arm whose name the decision never returns
    // is a path nothing ever takes, and nothing reports it.
    const def = addArm(branched(), "decision", "escalate");
    expect(forkAt(def, "decision")!.map.escalate).toBe("__end__");
    expect(bandsOf(def).map((b) => b.name)).toContain("escalate");
  });

  it("starts the new path below every existing one", () => {
    const def = addArm(branched(), "decision", "escalate");
    const bands = bandsOf(def);
    const added = bands.find((b) => b.name === "escalate")!;
    for (const other of bands.filter((b) => b.name !== "escalate")) {
      expect(added.min).toBeLessThan(other.min);
    }
  });

  it("leaves the other paths alone", () => {
    const before = forkAt(branched(), "decision")!.map;
    const after = forkAt(addArm(branched(), "decision", "escalate"), "decision")!.map;
    expect(after.pass).toBe(before.pass);
    expect(after.human_review).toBe(before.human_review);
    expect(after.reject).toBe(before.reject);
  });
});

describe("renameArm", () => {
  it("moves the arm and its band together", () => {
    // Renaming one and not the other gives either a path nothing reaches or a
    // decision returning a name no edge matches. Neither reports anything.
    const def = renameArm(branched(), "decision", "pass", "accepted");
    const map = forkAt(def, "decision")!.map;
    expect(map.accepted).toBe("notify");
    expect(map.pass).toBeUndefined();
    expect(bandsOf(def).map((b) => b.name)).toContain("accepted");
    expect(bandsOf(def).map((b) => b.name)).not.toContain("pass");
  });

  it("keeps the path in its place rather than moving it to the end", () => {
    const def = renameArm(branched(), "decision", "human_review", "ask_someone");
    expect(Object.keys(forkAt(def, "decision")!.map)).toEqual([
      "pass",
      "ask_someone",
      "reject",
    ]);
  });

  it("keeps the threshold the renamed path had", () => {
    const before = bandsOf(branched()).find((b) => b.name === "pass")!.min;
    const def = renameArm(branched(), "decision", "pass", "accepted");
    expect(bandsOf(def).find((b) => b.name === "accepted")!.min).toBe(before);
  });
});

describe("removeArm", () => {
  it("removes the path and its band", () => {
    const def = removeArm(branched(), "decision", "human_review");
    expect(forkAt(def, "decision")!.map.human_review).toBeUndefined();
    expect(bandsOf(def).map((b) => b.name)).not.toContain("human_review");
  });

  it("leaves the rest of the fork intact", () => {
    const def = removeArm(branched(), "decision", "human_review");
    expect(Object.keys(forkAt(def, "decision")!.map)).toEqual(["pass", "reject"]);
  });
});

describe("setArmThreshold", () => {
  it("moves one band and no other", () => {
    const def = setArmThreshold(branched(), "decision", "pass", 0.9);
    expect(bandsOf(def).find((b) => b.name === "pass")!.min).toBe(0.9);
    expect(bandsOf(def).find((b) => b.name === "human_review")!.min).toBe(0.35);
  });
});

describe("readBands", () => {
  it("fills in the engine's defaults for a branch that has none configured", () => {
    expect(bandsOf(branched()).map((b) => b.name)).toEqual([
      "pass",
      "human_review",
      "reject",
    ]);
  });

  it("says nothing about a step that is not a score decision", () => {
    expect(readBands({ impl: "syntra.match.process" })).toBeNull();
    expect(readBands(undefined)).toBeNull();
  });
});

describe("only a score branch may name its own paths", () => {
  it("is open for the score decision and closed for the result routers", () => {
    // A `result.*` router matches the previous step's output text and can
    // return exactly two fixed strings; a renamed arm there is never taken.
    expect(ROUTERS.find((r) => r.key === "branch_key")!.customOutcomes).toBe(true);
    for (const r of ROUTERS.filter((r) => r.key !== "branch_key")) {
      expect(r.customOutcomes).toBe(false);
    }
  });
});
