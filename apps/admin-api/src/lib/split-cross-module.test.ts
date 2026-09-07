/**
 * Splitting one authored flow into the workflows that will run.
 *
 * The case throughout is the live one: ASTRA gates a requirement, hands off via
 * `syntra.jd.normalized`, and SYNTRA matches. An author writes that as one
 * flow; the platform has to store it as two.
 */
import { describe, expect, it } from "vitest";
import {
  orderedSteps,
  resolveHandoff,
  splitByModule,
  type ModuleFacts,
  type SplitStep,
} from "./split-cross-module.js";

const moduleOf = new Map<string, string>([
  ["astra.requirement.quality", "astra"],
  ["astra.requirement.normalize", "astra"],
  ["astra.route.decision", "astra"],
  ["syntra.match.process", "syntra"],
  ["syntra.shortlist.notify", "syntra"],
  ["orbit.placement.confirm", "orbit"],
  ["human.gate", "platform"],
  ["orch.branch.decision", "platform"],
]);
/** Lent to everyone — borrowing one is not a handoff. */
const shareable = new Set(["human.gate", "orch.branch.decision"]);

const split = (nodes: SplitStep[], edges: Array<[string, string]>) =>
  splitByModule({ nodes, edges, moduleOf, shareable });

/** A linear flow: __start__ → a → b → … → __end__ */
function linear(steps: Array<[string, string]>) {
  const nodes = steps.map(([id, impl]) => ({ id, impl }));
  const edges: Array<[string, string]> = [["__start__", steps[0]![0]]];
  for (let i = 0; i < steps.length - 1; i += 1) {
    edges.push([steps[i]![0], steps[i + 1]![0]]);
  }
  edges.push([steps[steps.length - 1]![0], "__end__"]);
  return { nodes, edges };
}

describe("a flow inside one application", () => {
  it("is left alone", () => {
    const { nodes, edges } = linear([
      ["match", "syntra.match.process"],
      ["notify", "syntra.shortlist.notify"],
    ]);
    const out = split(nodes, edges);
    expect(out.singleModule).toBe(true);
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]!.module).toBe("syntra");
  });
});

describe("a flow that crosses applications", () => {
  const { nodes, edges } = linear([
    ["quality", "astra.requirement.quality"],
    ["route", "astra.route.decision"],
    ["match", "syntra.match.process"],
  ]);

  it("cuts where the owning application changes", () => {
    const out = split(nodes, edges);
    expect(out.singleModule).toBe(false);
    expect(out.segments.map((s) => s.module)).toEqual(["astra", "syntra"]);
    expect(out.segments[0]!.stepIds).toEqual(["quality", "route"]);
    expect(out.segments[1]!.stepIds).toEqual(["match"]);
  });

  it("gives each segment a runnable shape of its own", () => {
    const out = split(nodes, edges);
    expect(out.segments[0]!.edges).toEqual([
      ["__start__", "quality"],
      ["quality", "route"],
      ["route", "__end__"],
    ]);
    expect(out.segments[1]!.edges).toEqual([
      ["__start__", "match"],
      ["match", "__end__"],
    ]);
  });

  it("handles three applications in a row", () => {
    const three = linear([
      ["quality", "astra.requirement.quality"],
      ["match", "syntra.match.process"],
      ["place", "orbit.placement.confirm"],
    ]);
    expect(split(three.nodes, three.edges).segments.map((s) => s.module)).toEqual([
      "astra",
      "syntra",
      "orbit",
    ]);
  });
});

describe("shared steps do not cut the flow", () => {
  it("keeps a gate with the work it gates", () => {
    // The whole point of `shareable`: borrowing a capability is not a handoff.
    // Treating human.gate as its own owner would cut ASTRA into three.
    const { nodes, edges } = linear([
      ["quality", "astra.requirement.quality"],
      ["gate", "human.gate"],
      ["route", "astra.route.decision"],
    ]);
    const out = split(nodes, edges);
    expect(out.singleModule).toBe(true);
    expect(out.segments[0]!.stepIds).toEqual(["quality", "gate", "route"]);
  });

  it("gives a leading shared step to whoever comes first", () => {
    const { nodes, edges } = linear([
      ["gate", "human.gate"],
      ["match", "syntra.match.process"],
    ]);
    const out = split(nodes, edges);
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]!.module).toBe("syntra");
    expect(out.segments[0]!.stepIds).toEqual(["gate", "match"]);
  });

  it("does not invent an owner for a flow of only shared steps", () => {
    const { nodes, edges } = linear([
      ["gate", "human.gate"],
      ["branch", "orch.branch.decision"],
    ]);
    const out = split(nodes, edges);
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]!.module).toBe("platform");
  });
});

describe("orderedSteps", () => {
  it("follows the edges rather than the array order", () => {
    const nodes = [
      { id: "b", impl: "syntra.match.process" },
      { id: "a", impl: "astra.requirement.quality" },
    ];
    const edges: Array<[string, string]> = [
      ["__start__", "a"],
      ["a", "b"],
      ["b", "__end__"],
    ];
    expect(orderedSteps(nodes, edges)).toEqual(["a", "b"]);
  });

  it("still reports a step nothing reaches", () => {
    // Losing it in the split would be worse than showing it out of place.
    const nodes = [
      { id: "a", impl: "astra.requirement.quality" },
      { id: "orphan", impl: "syntra.match.process" },
    ];
    const edges: Array<[string, string]> = [
      ["__start__", "a"],
      ["a", "__end__"],
    ];
    expect(orderedSteps(nodes, edges)).toContain("orphan");
  });
});

describe("resolveHandoff", () => {
  const astra: ModuleFacts = {
    key: "astra",
    handsOff: ["syntra.jd.normalized", "astra.requirement.rejected"],
    frontDoor: ["astra.requirement.received"],
  };
  const syntra: ModuleFacts = {
    key: "syntra",
    handsOff: ["syntra.candidate.submitted"],
    frontDoor: ["syntra.jd.normalized"],
  };
  const known = new Set([
    "syntra.jd.normalized",
    "astra.requirement.rejected",
    "astra.requirement.received",
    "syntra.candidate.submitted",
  ]);

  it("prefers a road both sides already agreed on", () => {
    const h = resolveHandoff(astra, syntra, known, new Map());
    expect(h.eventType).toBe("syntra.jd.normalized");
    expect(h.exists).toBe(true);
  });

  it("says when that half already runs, so nothing needs building", () => {
    const bound = new Map([["syntra.jd.normalized", "syntra.authored"]]);
    expect(resolveHandoff(astra, syntra, known, bound).handledBy).toBe(
      "syntra.authored",
    );
  });

  it("falls back to something the upstream already publishes", () => {
    const stranger: ModuleFacts = { key: "relay", handsOff: [], frontDoor: [] };
    const h = resolveHandoff(astra, stranger, known, new Map());
    expect(h.exists).toBe(true);
    expect(astra.handsOff).toContain(h.eventType);
  });

  it("proposes one only when nothing fits, naming both sides", () => {
    const a: ModuleFacts = { key: "interview", handsOff: [], frontDoor: [] };
    const b: ModuleFacts = { key: "relay", handsOff: [], frontDoor: [] };
    const h = resolveHandoff(a, b, new Set(), new Map());
    expect(h.exists).toBe(false);
    // The name outlives whatever prompted it, so it says which two it joins.
    expect(h.eventType).toContain("interview");
    expect(h.eventType).toContain("relay");
  });
});
