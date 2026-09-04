/**
 * Whether a workflow can actually get what its steps need.
 *
 * The case that motivated this is live: `syntra.match.workflow` is bound to
 * `syntra.match.requested`, whose payload does not declare `resumeId`, which
 * `syntra.match.process` requires. It passes every structural check and dies
 * on its first real event.
 */
import { describe, expect, it } from "vitest";
import { checkInputsAvailable } from "./check-inputs-available.js";
import type { GraphDefinition } from "@tekisho/graph-contract";

/** What each node requires, as node_registry would report it. */
const required = new Map<string, readonly string[]>([
  ["syntra.match.process", ["resumeId"]],
  ["syntra.duplicate.merge", ["jobId"]],
  ["human.gate", []],
  ["astra.requirement.quality", []],
  ["orch.branch.decision", []],
  ["astra.route.decision", []],
]);

const check = (def: GraphDefinition, triggerFields: string[]) =>
  checkInputsAvailable({ def, triggerFields, requiredByImpl: required });

/** __start__ → match → __end__ */
const linear = (inputs?: Record<string, string>): GraphDefinition => ({
  graphKey: "syntra.match.workflow",
  nodes: [
    { id: "match", impl: "syntra.match.process", ...(inputs ? { inputs } : {}) },
  ],
  edges: [
    ["__start__", "match"],
    ["match", "__end__"],
  ],
});

describe("a step with no input map", () => {
  it("is satisfied when the trigger carries the field", () => {
    expect(check(linear(), ["resumeId", "jobId"])).toEqual([]);
  });

  it("is a problem when the trigger does not — the live case", () => {
    const problems = check(linear(), ["jobId"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain('needs "resumeId"');
    expect(problems[0]!.message).toContain("nothing provides it");
  });
});

describe("a step with an input map", () => {
  it("is satisfied by a trigger field under another name", () => {
    // The rename case: the node calls it resumeId, the event calls it cvId.
    expect(check(linear({ resumeId: "trigger.cvId" }), ["cvId"])).toEqual([]);
  });

  it("is a problem when the mapped trigger field does not exist", () => {
    const problems = check(linear({ resumeId: "trigger.nope" }), ["cvId"]);
    expect(problems[0]!.message).toContain("this event does not carry");
  });

  it("reports a malformed path", () => {
    const problems = check(linear({ resumeId: "process" }), ["resumeId"]);
    expect(problems[0]!.message).toContain("is not a source");
  });
});

describe("only REQUIRED fields are checked", () => {
  it("ignores a field the node declared optional", () => {
    // `human.gate` requires nothing here, so an empty trigger is fine.
    const def: GraphDefinition = {
      graphKey: "x.authored",
      nodes: [{ id: "gate", impl: "human.gate" }],
      edges: [
        ["__start__", "gate"],
        ["gate", "__end__"],
      ],
    };
    expect(check(def, [])).toEqual([]);
  });
});

describe("the branch rule", () => {
  /**
   *        quality
   *           │
   *        [branch]
   *      ╱      │      ╲
   *  normalize  human  (end)
   *      ╲      ╱
   *       merge
   */
  const branched = (inputs?: Record<string, string>): GraphDefinition => ({
    graphKey: "astra.requirement.workflow",
    nodes: [
      { id: "quality", impl: "astra.requirement.quality" },
      { id: "branch", impl: "orch.branch.decision" },
      { id: "normalize", impl: "astra.route.decision" },
      { id: "human", impl: "human.gate" },
      { id: "merge", impl: "syntra.duplicate.merge", ...(inputs ? { inputs } : {}) },
    ],
    edges: [
      ["__start__", "quality"],
      ["quality", "branch"],
      ["normalize", "merge"],
      ["human", "merge"],
      ["merge", "__end__"],
    ],
    conditionalEdges: [
      {
        from: "branch",
        router: "branch_key",
        map: { pass: "normalize", human_review: "human", reject: "__end__" },
      },
    ],
  });

  it("refuses a required field from a step that might not run", () => {
    // `normalize` runs only on the pass arm. On human_review it never runs,
    // so `merge` would be missing a field it cannot work without.
    const problems = check(branched({ jobId: "normalize.jobId" }), []);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("never runs");
  });

  it("accepts a required field from a step on every path", () => {
    // `quality` runs before the branch, so every route through the workflow
    // passes through it.
    expect(check(branched({ jobId: "quality.jobId" }), [])).toEqual([]);
  });

  it("accepts a required field from the trigger, whatever the branching", () => {
    expect(check(branched(), ["jobId"])).toEqual([]);
  });
});

describe("what it reports", () => {
  it("names the step and the field, not just a count", () => {
    const problems = check(linear(), []);
    expect(problems[0]).toMatchObject({ nodeId: "match", field: "resumeId" });
  });

  it("finds every problem rather than stopping at the first", () => {
    const def: GraphDefinition = {
      graphKey: "x.authored",
      nodes: [
        { id: "match", impl: "syntra.match.process" },
        { id: "merge", impl: "syntra.duplicate.merge" },
      ],
      edges: [
        ["__start__", "match"],
        ["match", "merge"],
        ["merge", "__end__"],
      ],
    };
    expect(check(def, [])).toHaveLength(2);
  });
});
