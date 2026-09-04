/**
 * What a model is told about a node.
 *
 * The case these are written around is real: the prose catalogue says
 * `syntra.match.process` requires `jobId` and knows nothing of
 * `requirement_id`, while the contract the runtime enforces says the opposite.
 * A graph built on the prose passes every structural check and then cannot
 * carry data through itself, which is the most expensive kind of wrong.
 */
import { describe, expect, it } from "vitest";
import {
  describeNode,
  describeSchema,
  type PromptNode,
} from "./describe-node-for-prompt.js";

/** Shaped exactly as `node_registry` stores it — z.toJSONSchema output. */
const matchProcess: PromptNode = {
  key: "syntra.match.process",
  title: "Score a match",
  description: "Score a job against a resume.",
  module: "syntra",
  sideEffect: "internal_write",
  input: {
    type: "object",
    required: ["resumeId"],
    properties: {
      jobId: { type: "string", minLength: 1 },
      resumeId: { type: "string", minLength: 1 },
      requirement_id: { type: "string", minLength: 1 },
      skillMatchScore: { type: "number" },
    },
  },
  output: {
    type: "object",
    required: ["jobId", "status"],
    properties: {
      jobId: { type: "string" },
      status: { type: "string" },
      skillMatchScore: { type: "number" },
    },
  },
  config: {
    type: "object",
    properties: {
      matchThreshold: {
        type: "number",
        minimum: 0,
        maximum: 1,
        label: "Match threshold",
        adminExposed: true,
      },
      hardFilters: { type: "array", items: { type: "string" } },
    },
  },
};

describe("describeSchema", () => {
  it("says which fields are required and which are not", () => {
    const lines = describeSchema(matchProcess.input);
    expect(lines.some((l) => l.includes("resumeId: string, required"))).toBe(true);
    expect(lines.some((l) => l.includes("jobId: string") && !l.includes("required"))).toBe(true);
  });

  it("puts required fields first, because the first names read carry weight", () => {
    const lines = describeSchema(matchProcess.input);
    expect(lines[0]).toContain("resumeId");
  });

  it("states a range where the schema has one", () => {
    // The prompt's own rule says matchThreshold is 0–100. The contract says
    // 0–1. Reading it off the schema is how that stops being a guess.
    expect(describeSchema(matchProcess.config).join("\n")).toContain("0–1");
  });

  it("renders arrays as their element type", () => {
    expect(describeSchema(matchProcess.config).join("\n")).toContain(
      "hardFilters: string[]",
    );
  });

  it("says nothing for a node that declared nothing", () => {
    expect(describeSchema(null)).toEqual([]);
    expect(describeSchema({ type: "object" })).toEqual([]);
  });
});

describe("describeNode", () => {
  const text = describeNode(matchProcess);

  it("names every field the runtime will accept", () => {
    // requirement_id is the field the live ASTRA handoff carries, and the
    // prose catalogue has never mentioned it.
    expect(text).toContain("requirement_id");
    expect(text).toContain("skillMatchScore");
  });

  it("does not claim an optional field is required", () => {
    const takes = text.slice(text.indexOf("Takes:"), text.indexOf("Returns:"));
    const jobIdLine = takes.split("\n").find((l) => l.includes("jobId"))!;
    expect(jobIdLine).not.toContain("required");
  });

  it("says who owns the node and what it does to the world", () => {
    expect(text).toContain("owned by syntra");
    expect(text).toContain("internal write");
  });

  it("adds the event hints without letting them displace the schema", () => {
    const withHints = describeNode({
      ...matchProcess,
      triggeredBy: "syntra.match.requested",
      emits: "syntra.match.completed",
    });
    expect(withHints).toContain("usually follows syntra.match.requested");
    expect(withHints).toContain("publishes syntra.match.completed");
    expect(withHints).toContain("resumeId: string, required");
  });

  it("says so out loud when a node has no contract", () => {
    // Silence would read as "takes nothing", and the model would wire it up
    // with no inputs at all.
    const undeclared = describeNode({
      ...matchProcess,
      key: "astra.requirement.quality",
      input: null,
      output: null,
      config: null,
    });
    expect(undeclared).toContain("not declared");
  });

  it("lists the paths a branching node offers", () => {
    const branch = describeNode({
      ...matchProcess,
      key: "orch.branch.decision",
      paths: ["pass", "human_review", "reject"],
    });
    expect(branch).toContain("Branching labels");
    expect(branch).toContain("pass, human_review, reject");
  });
});
