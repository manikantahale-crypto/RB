/**
 * The repair that stops a good proposal being thrown away.
 *
 * Measured against the real registry: two of three gpt-4o-mini requests were
 * refused with "nothing reaches __end__" and nothing else wrong — the right
 * steps, the right order, every impl registered, and no edge saying where the
 * flow finished. The author saw one arbitrary placeholder step instead.
 */

import { describe, expect, it } from "vitest";
import { closeOpenEnds, sinksOf } from "./close-open-ends.js";

const g = (over: Record<string, unknown> = {}) => ({
  graphKey: "syntra.authored",
  nodes: [
    { id: "process", impl: "syntra.jd.process" },
    { id: "match", impl: "syntra.continuous.match" },
  ],
  edges: [
    ["__start__", "process"],
    ["process", "match"],
  ],
  ...over,
});

describe("sinksOf", () => {
  it("finds the step nothing leaves", () => {
    expect(
      sinksOf(["a", "b", "c"], [
        ["__start__", "a"],
        ["a", "b"],
        ["b", "c"],
      ]),
    ).toEqual(["c"]);
  });

  it("finds every sink when the flow branches", () => {
    expect(
      sinksOf(["a", "yes", "no"], [
        ["__start__", "a"],
        ["a", "yes"],
        ["a", "no"],
      ]),
    ).toEqual(["yes", "no"]);
  });

  it("does not call a branch source a sink", () => {
    // A decision leaves through its arms. Treating it as a sink would wire it
    // straight to __end__ and shortcut every arm it exists to choose between.
    expect(sinksOf(["branch", "yes"], [["__start__", "branch"]], ["branch"])).toEqual([
      "yes",
    ]);
  });
});

describe("closeOpenEnds", () => {
  it("wires the last step to __end__", () => {
    const out = closeOpenEnds(g());
    expect(out.edges).toEqual([
      ["__start__", "process"],
      ["process", "match"],
      ["match", "__end__"],
    ]);
  });

  it("leaves a finished graph exactly as it was", () => {
    const finished = g({
      edges: [
        ["__start__", "process"],
        ["process", "match"],
        ["match", "__end__"],
      ],
    });
    expect(closeOpenEnds(finished)).toBe(finished);
  });

  it("finishes every arm of a branch, not just the first", () => {
    // Terminating one arm and stranding the others would be worse than the
    // error this replaces: it would pass validation and lose work silently.
    const out = closeOpenEnds({
      nodes: [{ id: "b" }, { id: "yes" }, { id: "no" }],
      edges: [
        ["__start__", "b"],
        ["b", "yes"],
        ["b", "no"],
      ],
    });
    expect(out.edges).toContainEqual(["yes", "__end__"]);
    expect(out.edges).toContainEqual(["no", "__end__"]);
  });

  it("changes nothing but the edges", () => {
    const before = g();
    const out = closeOpenEnds(before);
    expect(out.nodes).toBe(before.nodes);
    expect(out.graphKey).toBe("syntra.authored");
  });

  it("leaves a flow that loops back on itself alone", () => {
    /*
     * Every node has an outgoing edge and none reaches the end — that is a
     * cycle, a real fault. Inventing a terminal would hide it, so it goes back
     * untouched for the validator to refuse.
     */
    const loop = {
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [
        ["__start__", "a"],
        ["a", "b"],
        ["b", "a"],
      ],
    };
    expect(closeOpenEnds(loop)).toBe(loop);
  });

  it("leaves a proposal with no nodes alone", () => {
    const empty = { nodes: [], edges: [] };
    expect(closeOpenEnds(empty)).toBe(empty);
  });

  it("survives a proposal with no edges at all", () => {
    const out = closeOpenEnds({ nodes: [{ id: "only" }] } as {
      nodes: Array<{ id: string }>;
      edges?: unknown;
    });
    expect(out.edges).toEqual([["only", "__end__"]]);
  });

  it("ignores malformed edge entries rather than throwing", () => {
    const out = closeOpenEnds({
      nodes: [{ id: "a" }],
      edges: [["__start__", "a"], "nonsense", ["a"]],
    });
    expect(out.edges).toContainEqual(["a", "__end__"]);
  });
});
