/**
 * The check that blocked every workflow the platform can author.
 *
 * It refused any key containing `.workflow` — a rule from the agent era, when
 * authored graphs were `<agent>.authored` and `.workflow` meant "seeded by a
 * migration". The unit of authorship is now a workflow and the proposer names
 * them `${module}.${word}.workflow`, so the gate refused its own convention
 * and nothing authored through screen 2 could go live.
 */
import { describe, expect, it } from "vitest";
import { evaluateGoLiveGate } from "./go-live-gate.js";

const definition = {
  graphKey: "syntra.a.workflow",
  nodes: [{ id: "process", impl: "syntra.jd.process" }],
  edges: [
    ["__start__", "process"],
    ["process", "__end__"],
  ],
};

const gate = (over: Record<string, unknown> = {}) =>
  evaluateGoLiveGate({
    artifactSource: JSON.stringify(definition, null, 2) + "\n",
    storedChecksum: "",
    expectedGraphKey: "syntra.a.workflow",
    artifactKind: "workflow",
    gapAck: null,
    oneActiveIndexPerGraphKey: true,
    ...over,
  });

const collision = (result: ReturnType<typeof gate>) =>
  result.checks.find((c) => c.id === "no_runtime_key_collision")!;

describe("no_runtime_key_collision", () => {
  it("allows a key ending .workflow, which is what the proposer generates", () => {
    expect(collision(gate()).ok).toBe(true);
  });

  it("still refuses a definition that disagrees about its own key", () => {
    /*
     * The real check. A definition stored under one key that names another
     * would run as whichever the caller asked for, and the two would drift.
     */
    const out = gate({ expectedGraphKey: "syntra.b.workflow" });
    expect(collision(out).ok).toBe(false);
    expect(collision(out).message).toContain("syntra.b.workflow");
  });

  it("still refuses when the one-live rule is not scoped per key", () => {
    // Activation would retire somebody else's workflow.
    const out = gate({ oneActiveIndexPerGraphKey: false });
    expect(collision(out).ok).toBe(false);
    expect(collision(out).message).toContain("one-active");
  });

  it("does not object to a seeded workflow being edited", () => {
    /*
     * `syntra.match.workflow` is active, editable, and was seeded. Refusing it
     * meant an existing workflow could be changed but never put back.
     */
    const seeded = { ...definition, graphKey: "syntra.match.workflow" };
    const out = evaluateGoLiveGate({
      artifactSource: JSON.stringify(seeded, null, 2) + "\n",
      storedChecksum: "",
      expectedGraphKey: "syntra.match.workflow",
      artifactKind: "workflow",
      gapAck: null,
      oneActiveIndexPerGraphKey: true,
    });
    expect(collision(out).ok).toBe(true);
  });
});
