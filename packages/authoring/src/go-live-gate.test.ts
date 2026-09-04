/**
 * The two gate checks that ask about more than shape.
 *
 * Both exist because a real workflow got past the other six. `shareable` has
 * been advisory since it was introduced — it filters the editor's palette and
 * nothing looks at it again — and `relay.intake.workflow` is live using
 * `astra.requirement.intake`, which ASTRA keeps private.
 */
import { describe, expect, it } from "vitest";
import { evaluateGoLiveGate, type GoLiveGateInput } from "./go-live-gate.js";
import { checksumOf } from "@tekisho/graph-contract";

/** A definition, its artifact text and its checksum, as the gate wants them. */
function artifact(nodes: Array<{ id: string; impl: string }>, entryInput?: string) {
  const def = {
    graphKey: "relay.authored",
    ...(entryInput ? { entryInput } : {}),
    nodes,
    edges: [
      ["__start__", nodes[0]!.id],
      ...nodes.slice(1).map((n, i) => [nodes[i]!.id, n.id]),
      [nodes[nodes.length - 1]!.id, "__end__"],
    ],
  };
  const source = `${JSON.stringify(def, null, 2)}\n`;
  return { source, checksum: checksumOf(JSON.parse(source)) };
}

function gate(over: Partial<GoLiveGateInput> = {}) {
  const { source } = artifact([{ id: "intake", impl: "astra.requirement.intake" }]);
  return evaluateGoLiveGate({
    artifactSource: source,
    storedChecksum: "",
    expectedGraphKey: "relay.authored",
    gapAck: { acknowledged: true, unsupported: [] },
    oneActiveIndexPerGraphKey: true,
    ...over,
  });
}

const checkFor = (r: ReturnType<typeof gate>, id: string) =>
  r.checks.find((c) => c.id === id);

describe("check 8 — may this workflow use these steps", () => {
  const ownership = (over: Partial<NonNullable<GoLiveGateInput["ownership"]>> = {}) => ({
    graphModule: "relay",
    moduleByImpl: new Map([
      ["astra.requirement.intake", "astra"],
      ["relay.consent.send", "relay"],
      ["human.gate", "platform"],
    ]),
    shareableImpls: new Set(["human.gate"]),
    ...over,
  });

  it("blocks the live violation", () => {
    // relay.intake.workflow uses astra.requirement.intake, shareable = false.
    const check = checkFor(gate({ ownership: ownership() }), "impls_permitted");
    expect(check?.ok).toBe(false);
    expect(check?.message).toContain("astra.requirement.intake");
    expect(check?.message).toContain("astra keeps private");
  });

  it("allows a step the workflow's own application owns", () => {
    const { source } = artifact([{ id: "send", impl: "relay.consent.send" }]);
    const check = checkFor(
      gate({ artifactSource: source, ownership: ownership() }),
      "impls_permitted",
    );
    expect(check?.ok).toBe(true);
  });

  it("allows platform capability, because it is shareable — not special", () => {
    const { source } = artifact([{ id: "gate", impl: "human.gate" }]);
    const check = checkFor(
      gate({ artifactSource: source, ownership: ownership() }),
      "impls_permitted",
    );
    expect(check?.ok).toBe(true);
  });

  it("allows another application's step when that application lent it", () => {
    const check = checkFor(
      gate({
        ownership: ownership({
          shareableImpls: new Set(["human.gate", "astra.requirement.intake"]),
        }),
      }),
      "impls_permitted",
    );
    expect(check?.ok).toBe(true);
  });

  it("stays quiet about a step the registry has never heard of", () => {
    // That is check 1's job. Reporting it twice helps nobody.
    const check = checkFor(
      gate({ ownership: ownership({ moduleByImpl: new Map() }) }),
      "impls_permitted",
    );
    expect(check?.ok).toBe(true);
  });

  it("says it could not check rather than passing, with no registry", () => {
    const check = checkFor(gate(), "impls_permitted");
    expect(check?.ok).toBe(true);
    expect(check?.message).toContain("not checked");
  });

  it("refuses a workflow whose key does not name an application", () => {
    // `duplicate.review` and `resume.intake` are both live. Splitting the key
    // on a dot read "duplicate" as an application and made every SYNTRA step
    // inside look foreign — false findings, which teach people to ignore the
    // check.
    const check = checkFor(
      gate({ ownership: ownership({ graphModule: null }) }),
      "impls_permitted",
    );
    expect(check?.ok).toBe(false);
    expect(check?.message).toContain("does not say which application");
    // And it must not accuse the steps of anything.
    expect(check?.message).not.toContain("keeps private");
  });
});

describe("check 7 — can every step get what it needs", () => {
  it("blocks a step whose required field the trigger does not carry", () => {
    const { source } = artifact(
      [{ id: "match", impl: "syntra.match.process" }],
      "syntra.match.requested",
    );
    const check = checkFor(
      gate({
        artifactSource: source,
        expectedGraphKey: "relay.authored",
        inputs: {
          triggerDeclared: true,
          triggerFields: ["jobId"],
          requiredByImpl: new Map([["syntra.match.process", ["resumeId"]]]),
        },
      }),
      "inputs_available",
    );
    expect(check?.ok).toBe(false);
    expect(check?.message).toContain("resumeId");
  });

  it("passes when the trigger carries it", () => {
    const { source } = artifact(
      [{ id: "match", impl: "syntra.match.process" }],
      "syntra.match.requested",
    );
    const check = checkFor(
      gate({
        artifactSource: source,
        inputs: {
          triggerDeclared: true,
          triggerFields: ["jobId", "resumeId"],
          requiredByImpl: new Map([["syntra.match.process", ["resumeId"]]]),
        },
      }),
      "inputs_available",
    );
    expect(check?.ok).toBe(true);
  });

  it("says it could not check rather than passing, with no evidence", () => {
    const check = checkFor(gate(), "inputs_available");
    expect(check?.ok).toBe(true);
    expect(check?.message).toContain("not checked");
  });

  it("does not accuse the steps when the event declares no payload", () => {
    // Eight event schemas are empty today, and `syntra.match.requested` — one
    // of them — has been published 197 times. An empty schema means nobody
    // wrote down what the event carries, not that it carries nothing.
    const { source } = artifact(
      [{ id: "match", impl: "syntra.match.process" }],
      "syntra.match.requested",
    );
    const check = checkFor(
      gate({
        artifactSource: source,
        inputs: {
          triggerDeclared: false,
          triggerFields: [],
          requiredByImpl: new Map([["syntra.match.process", ["resumeId"]]]),
        },
      }),
      "inputs_available",
    );
    expect(check?.ok).toBe(true);
    expect(check?.message).toContain("does not declare");
    expect(check?.message).not.toContain("resumeId");
  });
});
