/**
 * Answering from what already runs.
 *
 * The fixture is the design's worked example: "when a requirement arrives and
 * finishes intake, match it against our candidates. Accept at 92" against
 * `syntra.authored`, which already does all of it at a threshold of 60.
 */
import { describe, expect, it } from "vitest";
import {
  resolveAgainstExisting,
  type ConfigWanted,
  type ExistingNode,
} from "./resolve-before-generate.js";

const nodes: ExistingNode[] = [
  { id: "jd", impl: "syntra.jd.process", config: {} },
  {
    id: "match",
    impl: "syntra.match.process",
    config: { matchThreshold: 0.6, rerank: true },
  },
];

const declaredFieldsOf = new Map<string, readonly string[]>([
  ["syntra.jd.process", ["matchThreshold", "rerank"]],
  ["syntra.match.process", ["matchThreshold", "rerank"]],
  ["syntra.duplicate.merge", []],
]);

const wanted: ConfigWanted[] = [
  { field: "matchThreshold", value: 0.92, phrase: "Accept at 92" },
];

const resolve = (over: Record<string, unknown> = {}) =>
  resolveAgainstExisting({
    triggerEventType: "syntra.jd.normalized",
    boundTo: new Map([["syntra.jd.normalized", "syntra.authored"]]),
    existing: { graphKey: "syntra.authored", version: 119, nodes },
    wanted,
    declaredFieldsOf,
    ...over,
  } as Parameters<typeof resolveAgainstExisting>[0]);

describe("resolveAgainstExisting", () => {
  it("answers the worked example with one field, not a new workflow", () => {
    // The most common request, and the one generation handled worst: it built
    // a second workflow doing what the first already did.
    const out = resolve();
    expect(out.kind).toBe("change");
    if (out.kind !== "change") return;
    expect(out.graphKey).toBe("syntra.authored");
    expect(out.version).toBe(119);
    expect(out.changes).toHaveLength(2); // both steps declare matchThreshold
    expect(out.summary).toContain("This already runs");
  });

  it("names the change exactly when there is only one", () => {
    const out = resolve({
      existing: { graphKey: "syntra.authored", version: 119, nodes: [nodes[1]!] },
    });
    expect(out.kind).toBe("change");
    if (out.kind !== "change") return;
    expect(out.summary).toContain("matchThreshold on match: 0.6 → 0.92");
  });

  it("only touches steps that DECLARE the setting", () => {
    // Stamping matchThreshold onto a step whose schema has no such field gives
    // a graph a config key nothing reads: it validates, it saves, and it
    // changes nothing.
    const out = resolve({
      existing: {
        graphKey: "syntra.authored",
        version: 119,
        nodes: [{ id: "merge", impl: "syntra.duplicate.merge", config: {} }],
      },
    });
    expect(out.kind).toBe("generate");
  });

  it("says so rather than offering a no-op edit", () => {
    const out = resolve({
      existing: {
        graphKey: "syntra.authored",
        version: 119,
        nodes: [
          { id: "match", impl: "syntra.match.process", config: { matchThreshold: 0.92 } },
        ],
      },
    });
    expect(out.kind).toBe("already-satisfied");
    if (out.kind !== "already-satisfied") return;
    expect(out.summary).toContain("Nothing needs building");
  });

  it("generates when nothing is bound to the trigger", () => {
    // No existing workflow answers this event, so there is nothing to change.
    const out = resolve({ boundTo: new Map() });
    expect(out.kind).toBe("generate");
    if (out.kind !== "generate") return;
    expect(out.reason).toContain("Nothing is bound");
  });

  it("generates when the description asks for no recognisable setting", () => {
    // "notify the recruiter as well" is a request for a STEP, not a value.
    // Resolving it as a config change would silently refuse to build it.
    const out = resolve({ wanted: [] });
    expect(out.kind).toBe("generate");
  });

  it("generates when there is no trigger at all", () => {
    expect(resolve({ triggerEventType: null }).kind).toBe("generate");
  });

  it("generates when the bound workflow has no stored steps", () => {
    const out = resolve({
      existing: { graphKey: "syntra.authored", version: 119, nodes: [] },
    });
    expect(out.kind).toBe("generate");
  });

  it("reports the previous value, including when it was unset", () => {
    const out = resolve({
      existing: {
        graphKey: "syntra.authored",
        version: 119,
        nodes: [{ id: "match", impl: "syntra.match.process" }],
      },
    });
    expect(out.kind).toBe("change");
    if (out.kind !== "change") return;
    expect(out.changes[0]!.from).toBeUndefined();
    expect(out.changes[0]!.to).toBe(0.92);
  });

  it("keeps the author's own words on the change", () => {
    // The ledger cites the phrase back, so somebody can see which part of what
    // they wrote produced which change.
    const out = resolve();
    expect(out.kind).toBe("change");
    if (out.kind !== "change") return;
    expect(out.changes[0]!.phrase).toBe("Accept at 92");
  });
});
