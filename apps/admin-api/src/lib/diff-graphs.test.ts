/**
 * Comparing two stored versions of a workflow.
 *
 * The case that matters most is the smallest one: an author changed a single
 * threshold and wants to see that, not a hundred lines of unchanged JSON with
 * the answer somewhere inside it.
 */
import { describe, expect, it } from "vitest";
import { diffGraphs, type GraphLike } from "./diff-graphs.js";

const v119: GraphLike = {
  entryInput: "syntra.jd.normalized",
  nodes: [
    { id: "jd", impl: "syntra.jd.process", config: {} },
    { id: "resume", impl: "syntra.resume.process", config: {} },
    {
      id: "match",
      impl: "syntra.match.process",
      config: { matchThreshold: 60, rerank: true },
    },
  ],
  edges: [
    ["__start__", "jd"],
    ["jd", "resume"],
    ["resume", "match"],
    ["match", "__end__"],
  ],
};

/** The worked example: one field, on one step. */
const v120: GraphLike = {
  ...v119,
  nodes: [
    v119.nodes![0]!,
    v119.nodes![1]!,
    {
      id: "match",
      impl: "syntra.match.process",
      config: { matchThreshold: 92, rerank: true },
    },
  ],
};

describe("diffGraphs", () => {
  it("names the one setting that changed, exactly", () => {
    // The whole story, in the sentence, so an author who trusts it never has
    // to read the rest.
    const d = diffGraphs(v119, v120);
    expect(d.summary).toBe("One setting changed: match.matchThreshold 60 → 92.");
    expect(d.nodes).toHaveLength(1);
    expect(d.nodes[0]!.config).toEqual([
      { field: "matchThreshold", from: 60, to: 92 },
    ]);
    expect(d.identical).toBe(false);
  });

  it("reports nothing when nothing behavioural differs", () => {
    expect(diffGraphs(v119, structuredClone(v119)).identical).toBe(true);
    expect(diffGraphs(v119, v119).summary).toContain("Nothing");
  });

  it("ignores key order, which is not a change", () => {
    // The same settings written by two code paths. Telling an author their
    // threshold moved when it did not is worse than showing no diff at all.
    const reordered: GraphLike = {
      ...v119,
      nodes: [
        v119.nodes![0]!,
        v119.nodes![1]!,
        {
          id: "match",
          impl: "syntra.match.process",
          config: { rerank: true, matchThreshold: 60 },
        },
      ],
    };
    expect(diffGraphs(v119, reordered).identical).toBe(true);
  });

  it("ignores key order inside a nested object too", () => {
    const nest = (cfg: Record<string, unknown>): GraphLike => ({
      nodes: [{ id: "n", impl: "x", config: cfg }],
    });
    const a = nest({ retry: { max: 3, fallback: "human" } });
    const b = nest({ retry: { fallback: "human", max: 3 } });
    expect(diffGraphs(a, b).identical).toBe(true);
  });

  it("sees a step added and a step removed", () => {
    const trimmed: GraphLike = {
      ...v119,
      nodes: [v119.nodes![0]!, v119.nodes![2]!],
    };
    const d = diffGraphs(v119, trimmed);
    expect(d.nodes.map((n) => [n.id, n.kind])).toEqual([["resume", "removed"]]);
    expect(d.summary).toContain("1 step removed");
  });

  it("sees one step swapped for another", () => {
    const swapped: GraphLike = {
      ...v119,
      nodes: [
        { id: "jd", impl: "syntra.continuous.match", config: {} },
        v119.nodes![1]!,
        v119.nodes![2]!,
      ],
    };
    const d = diffGraphs(v119, swapped);
    expect(d.nodes[0]).toMatchObject({
      id: "jd",
      kind: "changed",
      impl: "syntra.continuous.match",
      implFrom: "syntra.jd.process",
    });
  });

  it("sees the trigger change", () => {
    const d = diffGraphs(v119, { ...v119, entryInput: "syntra.jd.received" });
    expect(d.trigger).toEqual({
      from: "syntra.jd.normalized",
      to: "syntra.jd.received",
      changed: true,
    });
    expect(d.summary.toLowerCase()).toContain("the trigger changed");
  });

  it("sees connections rewired", () => {
    // Edges decide what runs after what, so this is a behavioural change even
    // when every step is untouched.
    const rewired: GraphLike = {
      ...v119,
      edges: [
        ["__start__", "jd"],
        ["jd", "match"],
        ["match", "resume"],
        ["resume", "__end__"],
      ],
    };
    const d = diffGraphs(v119, rewired);
    expect(d.edgesRemoved).toContainEqual(["jd", "resume"]);
    expect(d.edgesAdded).toContainEqual(["jd", "match"]);
    expect(d.summary).toContain("rewired");
  });

  it("counts several changes rather than naming one", () => {
    const busy: GraphLike = {
      entryInput: "syntra.jd.received",
      nodes: [
        { id: "jd", impl: "syntra.jd.process", config: { a: 1 } },
        { id: "extra", impl: "syntra.bench.alert", config: {} },
      ],
      edges: [["__start__", "jd"]],
    };
    const d = diffGraphs(v119, busy);
    expect(d.summary.toLowerCase()).toContain("the trigger changed");
    expect(d.summary).toContain("added");
    expect(d.summary).toContain("removed");
  });

  it("treats an unset field and a missing one as the same", () => {
    const a: GraphLike = { nodes: [{ id: "n", impl: "x" }] };
    const b: GraphLike = { nodes: [{ id: "n", impl: "x", config: {} }] };
    expect(diffGraphs(a, b).identical).toBe(true);
  });

  it("copes with empty definitions", () => {
    expect(diffGraphs({}, {}).identical).toBe(true);
  });
});
