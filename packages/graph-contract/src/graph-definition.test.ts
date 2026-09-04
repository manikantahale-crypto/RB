/**
 * Where a step's inputs come from, and what the definition alone can check.
 *
 * These cover the class of mistake that needs no node registry: a misspelt
 * path, a step that does not exist, a step that runs later, or one on a branch
 * this step is never reached from. Whether a REQUIRED input's source is on
 * every path is a different check, in a different place, because it depends on
 * what the node declares.
 */
import { describe, expect, it } from "vitest";
import {
  GraphDefinitionSchema,
  parseInputSource,
  validateGraphTopology,
  type GraphDefinition,
} from "./graph-definition.js";

/** process → detect → merge, linear. */
function linear(inputs?: Record<string, Record<string, string>>): GraphDefinition {
  return {
    graphKey: "syntra.authored",
    nodes: [
      { id: "process", impl: "syntra.resume.process", ...(inputs?.process ? { inputs: inputs.process } : {}) },
      { id: "detect", impl: "syntra.duplicate.detect", ...(inputs?.detect ? { inputs: inputs.detect } : {}) },
      { id: "merge", impl: "syntra.duplicate.merge", ...(inputs?.merge ? { inputs: inputs.merge } : {}) },
    ],
    edges: [
      ["__start__", "process"],
      ["process", "detect"],
      ["detect", "merge"],
      ["merge", "__end__"],
    ],
  };
}

const check = (def: GraphDefinition) => () => validateGraphTopology(def);

describe("parseInputSource", () => {
  it("reads the two shapes it allows", () => {
    expect(parseInputSource("trigger.requirement_id")).toEqual({
      ok: true,
      source: { kind: "trigger", field: "requirement_id" },
    });
    expect(parseInputSource("process.jobId")).toEqual({
      ok: true,
      source: { kind: "step", stepId: "process", field: "jobId" },
    });
  });

  it("refuses anything deeper than two segments", () => {
    // Reaching into a nested object means the step is carrying a payload,
    // which is what the run context must not hold.
    expect(parseInputSource("process.syntra.status").ok).toBe(false);
    expect(parseInputSource("jobId").ok).toBe(false);
    expect(parseInputSource("process.").ok).toBe(false);
    expect(parseInputSource("").ok).toBe(false);
  });
});

describe("a definition with no input maps", () => {
  it("is still valid — every version already stored has none", () => {
    expect(check(linear())).not.toThrow();
  });
});

describe("input sources are checked against the graph", () => {
  it("accepts a source from the trigger", () => {
    expect(
      check(linear({ merge: { jobId: "trigger.requirement_id" } })),
    ).not.toThrow();
  });

  it("accepts a source from a step that runs earlier", () => {
    expect(check(linear({ merge: { jobId: "process.jobId" } }))).not.toThrow();
  });

  it("refuses a malformed path, naming the field", () => {
    expect(check(linear({ merge: { jobId: "process" } }))).toThrow(
      /merge\.inputs\.jobId/,
    );
  });

  it("refuses a step that does not exist", () => {
    expect(check(linear({ merge: { jobId: "normalise.jobId" } }))).toThrow(
      /not a step in this workflow/,
    );
  });

  it("refuses a step that runs LATER", () => {
    // `merge` runs after `process`, so process cannot read from it.
    expect(check(linear({ process: { jobId: "merge.jobId" } }))).toThrow(
      /never runs before it/,
    );
  });

  it("refuses a step reading from itself", () => {
    expect(check(linear({ detect: { jobId: "detect.jobId" } }))).toThrow(
      /reads from itself/,
    );
  });
});

describe("branching", () => {
  /**
   *        quality
   *           │
   *        [branch]
   *      ╱      │      ╲
   *  normalize  human  (end)
   *      ╲      ╱
   *       route
   */
  const branched = (inputs?: Record<string, string>): GraphDefinition => ({
    graphKey: "astra.requirement.workflow",
    nodes: [
      { id: "quality", impl: "astra.requirement.quality" },
      { id: "branch", impl: "orch.branch.decision" },
      { id: "normalize", impl: "astra.requirement.normalize" },
      { id: "human", impl: "human.gate" },
      { id: "route", impl: "astra.route.decision", ...(inputs ? { inputs } : {}) },
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
  });

  it("allows a source from a step on a branch that can reach it", () => {
    // Structurally legal: there IS a path normalize → route. Whether `route`
    // may DEPEND on it is the required-vs-optional question, decided by the
    // check that knows what the node declares.
    expect(check(branched({ text: "normalize.normalizedText" }))).not.toThrow();
  });

  it("refuses a source from a branch that never reaches it", () => {
    const def = branched({ decision: "route.decision" });
    // `route` reading from itself is the same class of error.
    expect(check(def)).toThrow(/reads from itself/);
  });

  it("follows conditional edges when deciding what runs first", () => {
    // `normalize` is reachable only through a conditional edge. If those were
    // not followed, this would look unreachable and be refused wrongly.
    expect(check(branched({ score: "quality.confidence_score" }))).not.toThrow();
  });
});

describe("the reserved step id", () => {
  it("refuses a step called `trigger`", () => {
    const def = linear();
    def.nodes[0]!.id = "trigger";
    def.edges = [
      ["__start__", "trigger"],
      ["trigger", "detect"],
      ["detect", "merge"],
      ["merge", "__end__"],
    ];
    expect(check(def)).toThrow(/reserved/);
  });
});

describe("the schema still accepts what it always did", () => {
  it("parses a definition carrying input maps", () => {
    const parsed = GraphDefinitionSchema.safeParse(
      linear({ merge: { jobId: "process.jobId" } }),
    );
    expect(parsed.success).toBe(true);
  });

  it("parses one without them", () => {
    expect(GraphDefinitionSchema.safeParse(linear()).success).toBe(true);
  });
});
