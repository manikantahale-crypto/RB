/**
 * The order the outline panel reads a workflow in.
 *
 * Storage order and run order are the same thing right up until somebody
 * inserts a step, and then they are not — which is exactly when a summary
 * claiming to show the sequence starts lying. Every case below is a shape that
 * exists in the real definitions.
 */

import { describe, expect, it } from "vitest";
import { orderSteps } from "./outline-order.js";

const n = (...ids: string[]) => ids.map((id) => ({ id }));

describe("orderSteps", () => {
  it("follows the edges, not the array", () => {
    // `notify` was added last but runs second. This is what an inserted step
    // looks like in storage, and it is the whole reason for sorting.
    const order = orderSteps({
      nodes: n("normalise", "match", "notify"),
      edges: [
        ["__start__", "normalise"],
        ["normalise", "notify"],
        ["notify", "match"],
        ["match", "__end__"],
      ],
    });
    expect(order).toEqual(["normalise", "notify", "match"]);
  });

  it("does not treat __start__ and __end__ as steps", () => {
    const order = orderSteps({
      nodes: n("process"),
      edges: [
        ["__start__", "process"],
        ["process", "__end__"],
      ],
    });
    expect(order).toEqual(["process"]);
  });

  it("orders a branch's arms after the step that decides", () => {
    // astra.requirement.workflow's real shape: a decision fanning three ways.
    const order = orderSteps({
      nodes: n("quality", "branch", "normalize", "human"),
      edges: [
        ["__start__", "quality"],
        ["quality", "branch"],
      ],
      conditionalEdges: [
        {
          from: "branch",
          map: { pass: "normalize", reject: "__end__", human_review: "human" },
        },
      ],
    });
    expect(order.slice(0, 2)).toEqual(["quality", "branch"]);
    expect(order.slice(2).sort()).toEqual(["human", "normalize"]);
    expect(order).toHaveLength(4);
  });

  it("keeps a step no edge reaches, at the end", () => {
    // A step left disconnected mid-edit. It is the single thing that explains
    // why a workflow does less than its canvas suggests, so it must not vanish
    // from the summary.
    const order = orderSteps({
      nodes: n("first", "second", "orphaned"),
      edges: [
        ["__start__", "first"],
        ["first", "second"],
      ],
    });
    expect(order).toContain("orphaned");
    expect(order).toHaveLength(3);
    expect(order.indexOf("first")).toBeLessThan(order.indexOf("second"));
  });

  it("returns every node even when the graph has a cycle", () => {
    // A cycle makes indegree never reach zero. Returning a short list would
    // make `steps.length` disagree with the workflow.
    const order = orderSteps({
      nodes: n("a", "b", "c"),
      edges: [
        ["__start__", "a"],
        ["a", "b"],
        ["b", "c"],
        ["c", "b"],
      ],
    });
    expect(order).toHaveLength(3);
    expect(new Set(order)).toEqual(new Set(["a", "b", "c"]));
    expect(order[0]).toBe("a");
  });

  it("survives a definition with nothing in it", () => {
    // `orbit.lifecycle.workflow` v9 is stored as `{}`.
    expect(orderSteps({})).toEqual([]);
    expect(orderSteps({ nodes: [], edges: [] })).toEqual([]);
  });

  it("ignores edges pointing at steps that do not exist", () => {
    // A dangling edge left by a deleted step. It must not invent a step.
    const order = orderSteps({
      nodes: n("only"),
      edges: [
        ["__start__", "only"],
        ["only", "deleted"],
      ],
    });
    expect(order).toEqual(["only"]);
  });

  it("puts independent chains in the order they were authored", () => {
    // Two roots, nothing between them. Without a stable tie-break the panel
    // reorders itself between requests for no visible reason.
    const order = orderSteps({
      nodes: n("alpha", "beta"),
      edges: [
        ["__start__", "alpha"],
        ["__start__", "beta"],
      ],
    });
    expect(order).toEqual(["alpha", "beta"]);
  });
});
