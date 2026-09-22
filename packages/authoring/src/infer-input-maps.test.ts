/**
 * The workflow the author could not write.
 *
 * `relay.consent.workflow` is the one that forced this: `remind` needs
 * `consent_threads`, `send` produces it, and the only way to connect them was
 * for a person to type `remind.consent_threads ← send.consent_threads` — which
 * means knowing the field names inside two nodes and the id of a step. Both
 * sides already declare themselves, so nobody should have to.
 */
import { describe, expect, it } from "vitest";
import { describeWiring, inferInputMaps } from "./infer-input-maps.js";
import type { GraphDefinition } from "./graph-definition.js";

const OUTPUTS = new Map<string, string[]>([
  ["relay.consent.send", ["jobId", "status", "sent_count", "thread_ids", "consent_threads"]],
  ["relay.consent.remind", ["threadId", "candidateId", "reminderCount"]],
  ["prism.profile.mask", ["submissionId", "status", "maskedProfile"]],
  ["relay.profile.send", ["status", "candidateId", "threadId", "messageId"]],
  ["human.gate", ["decision"]],
]);

const INPUTS = new Map<string, string[]>([
  ["relay.consent.send", ["jobId", "top_candidates"]],
  ["relay.consent.remind", ["thread_id", "candidate_id", "consent_threads", "reminder_count"]],
  ["prism.profile.mask", ["submission_id", "masked_profile"]],
  ["relay.profile.send", ["candidate_id", "jobId", "masked_profile", "vendor_email"]],
  ["human.gate", ["decision"]],
]);

/** send → gate → remind, the shape that needed a map. */
function consentish(): GraphDefinition {
  return {
    graphKey: "relay.consent.workflow",
    nodes: [
      { id: "send", impl: "relay.consent.send" },
      { id: "gate", impl: "human.gate" },
      { id: "remind", impl: "relay.consent.remind" },
    ],
    edges: [
      ["__start__", "send"],
      ["send", "gate"],
      ["gate", "remind"],
      ["remind", "__end__"],
    ],
  } as unknown as GraphDefinition;
}

const base = { outputsByImpl: OUTPUTS, inputsByImpl: INPUTS };

describe("inferInputMaps", () => {
  it("connects a step to the upstream step that produces what it needs", () => {
    const { def, wired } = inferInputMaps({
      ...base,
      def: consentish(),
      triggerFields: ["jobId", "top_candidates"],
    });

    const remind = def.nodes.find((n) => n.id === "remind")!;
    expect(remind.inputs).toEqual({ consent_threads: "send.consent_threads" });
    expect(wired).toEqual([
      { nodeId: "remind", field: "consent_threads", fromStep: "send", source: "send.consent_threads" },
    ]);
  });

  it("leaves alone what the trigger already carries", () => {
    const { def } = inferInputMaps({
      ...base,
      def: consentish(),
      triggerFields: ["jobId", "top_candidates", "consent_threads"],
    });
    expect(def.nodes.find((n) => n.id === "remind")!.inputs).toBeUndefined();
  });

  it("never overwrites a map somebody wrote on purpose", () => {
    const def = consentish();
    def.nodes[2]!.inputs = { consent_threads: "trigger.previous_threads" };
    const out = inferInputMaps({ ...base, def, triggerFields: ["jobId"] });
    expect(out.def.nodes[2]!.inputs!.consent_threads).toBe("trigger.previous_threads");
    expect(out.wired.filter((w) => w.field === "consent_threads")).toHaveLength(0);
  });

  it("invents nothing — a field nobody produces stays unmapped for the gate to report", () => {
    const { def, wired } = inferInputMaps({
      ...base,
      def: consentish(),
      triggerFields: [],
    });
    const remind = def.nodes.find((n) => n.id === "remind")!;
    // `thread_id` and `candidate_id` are produced by nobody here.
    expect(remind.inputs).toEqual({ consent_threads: "send.consent_threads" });
    expect(wired.map((w) => w.field)).toEqual(["consent_threads"]);
  });

  it("takes the nearest producer when two steps offer the same field", () => {
    const def = {
      graphKey: "x",
      nodes: [
        { id: "first", impl: "relay.consent.send" },
        { id: "second", impl: "relay.consent.send" },
        { id: "remind", impl: "relay.consent.remind" },
      ],
      edges: [
        ["__start__", "first"],
        ["first", "second"],
        ["second", "remind"],
        ["remind", "__end__"],
      ],
    } as unknown as GraphDefinition;
    const { def: out } = inferInputMaps({ ...base, def, triggerFields: [] });
    expect(out.nodes.find((n) => n.id === "remind")!.inputs).toEqual({
      consent_threads: "second.consent_threads",
    });
  });

  it("prefers a step that always runs over a nearer one on a branch arm", () => {
    // `later` is one hop from `remind` and `early` is three, but `later` sits
    // on the yes arm — so on the no route its output was never produced. The
    // go-live check would refuse a map naming it.
    const def = {
      graphKey: "x",
      nodes: [
        { id: "early", impl: "relay.consent.send" },
        { id: "branch", impl: "orch.switch" },
        { id: "later", impl: "relay.consent.send" },
        { id: "remind", impl: "relay.consent.remind" },
      ],
      edges: [
        ["__start__", "early"],
        ["early", "branch"],
        ["later", "remind"],
        ["remind", "__end__"],
      ],
      conditionalEdges: [{ from: "branch", router: "branch_key", map: { yes: "later", no: "remind" } }],
    } as unknown as GraphDefinition;

    const { def: out } = inferInputMaps({ ...base, def, triggerFields: [] });
    expect(out.nodes.find((n) => n.id === "remind")!.inputs).toEqual({
      consent_threads: "early.consent_threads",
    });
  });

  it("follows branch arms, so a step after a decision still has upstream", () => {
    const def = {
      graphKey: "x",
      nodes: [
        { id: "mask", impl: "prism.profile.mask" },
        { id: "branch", impl: "orch.switch" },
        { id: "profile", impl: "relay.profile.send" },
      ],
      edges: [
        ["__start__", "mask"],
        ["mask", "branch"],
        ["profile", "__end__"],
      ],
      conditionalEdges: [{ from: "branch", router: "branch_key", map: { yes: "profile" } }],
    } as unknown as GraphDefinition;

    const { def: out, wired } = inferInputMaps({
      ...base,
      def,
      triggerFields: ["candidate_id", "jobId", "vendor_email"],
    });
    // mask produces `maskedProfile`, not `masked_profile` — the names must
    // match, and here they do not, so nothing is wired. That is the honest
    // answer; inventing a rename is how a workflow silently sends the wrong
    // thing.
    expect(out.nodes.find((n) => n.id === "profile")!.inputs).toBeUndefined();
    expect(wired).toHaveLength(0);
  });

  it("changes nothing when every step is fed by the trigger", () => {
    const def = {
      graphKey: "relay.intake.workflow",
      nodes: [
        { id: "route", impl: "orch.switch" },
        { id: "intake", impl: "relay.consent.send" },
      ],
      edges: [
        ["__start__", "route"],
        ["intake", "__end__"],
      ],
      conditionalEdges: [{ from: "route", router: "branch_key", map: { path_jd: "intake" } }],
    } as unknown as GraphDefinition;
    const { def: out, wired } = inferInputMaps({
      ...base,
      def,
      triggerFields: ["jobId", "top_candidates"],
    });
    expect(wired).toHaveLength(0);
    expect(out.nodes.every((n) => n.inputs === undefined)).toBe(true);
  });
});

describe("describeWiring", () => {
  it("says it the way a screen should, not the way the definition does", () => {
    const { wired } = inferInputMaps({
      ...base,
      def: consentish(),
      triggerFields: ["jobId", "top_candidates"],
    });
    expect(describeWiring(wired)).toEqual([
      "remind takes consent_threads from send",
    ]);
  });

  it("uses the titles a person sees when it has them", () => {
    const { wired } = inferInputMaps({
      ...base,
      def: consentish(),
      triggerFields: ["jobId", "top_candidates"],
    });
    const titles: Record<string, string> = { remind: "Remind the candidate", send: "Ask for consent" };
    expect(describeWiring(wired, (id) => titles[id] ?? id)).toEqual([
      "Remind the candidate takes consent_threads from Ask for consent",
    ]);
  });
});
