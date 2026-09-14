/**
 * Choosing the trigger once the shape is known.
 *
 * The first case is the blunder that caused this to be written: asked to
 * "match the candidates for a job requirement", screen 2 suggested
 * `syntra.match.completed` — the event saying matching has already finished —
 * to start a workflow whose job is matching. Word overlap cannot tell an
 * outcome from an input, and both contain "match".
 */

import { describe, expect, it } from "vitest";
import { rankWithGraph, type RankableCandidate } from "./rank-with-graph.js";

const cand = (
  eventType: string,
  wordRank: number,
  payloadFields: string[] = [],
  declaresPayload = true,
): RankableCandidate => ({ eventType, wordRank, payloadFields, declaresPayload });

describe("rankWithGraph", () => {
  it("does not suggest an event the workflow itself publishes", () => {
    // syntra.continuous.match emits syntra.match.completed. Triggering on it
    // means every run starts another, for ever.
    const out = rankWithGraph({
      candidates: [
        cand("syntra.match.completed", 0, ["jobId"]),
        cand("syntra.match.requested", 1, ["jobId"]),
      ],
      emittedByGraph: ["syntra.match.completed"],
      firstStepRequires: ["jobId"],
      firstStepImpl: "syntra.continuous.match",
    });
    expect(out[0]!.eventType).toBe("syntra.match.requested");
    expect(out[1]!.selfTriggering).toBe(true);
    expect(out[1]!.why).toContain("restart itself");
  });

  it("prefers the event that carries what the first step needs", () => {
    // The signal word overlap cannot give. Both mention matching; only one
    // carries the field the step requires.
    const out = rankWithGraph({
      candidates: [
        cand("syntra.match.completed", 0, ["match_job_id", "result_count"]),
        cand("syntra.match.requested", 1, ["jobId", "resumeId"]),
      ],
      emittedByGraph: [],
      firstStepRequires: ["jobId"],
      firstStepImpl: "syntra.match.process",
    });
    expect(out[0]!.eventType).toBe("syntra.match.requested");
    expect(out[0]!.satisfies).toBe(1);
    expect(out[0]!.why).toContain("carries everything");
  });

  it("keeps the word matcher's order when nothing separates them", () => {
    // No reordering on a hunch. Two events that feed the step equally well
    // stay in the order the words put them.
    const out = rankWithGraph({
      candidates: [
        cand("syntra.jd.received", 0, ["jobId"]),
        cand("syntra.jd.parsed", 1, ["jobId"]),
      ],
      emittedByGraph: [],
      firstStepRequires: ["jobId"],
    });
    expect(out.map((c) => c.eventType)).toEqual([
      "syntra.jd.received",
      "syntra.jd.parsed",
    ]);
  });

  it("does not punish an event whose payload nobody described", () => {
    /*
     * Eight schemas are placeholders written at boot so ingress could accept
     * an event nobody had documented. Scoring those zero would bury them for a
     * gap in the CATALOGUE rather than a fault in the event — the same trap
     * the inputs_available check was careful to avoid.
     */
    const out = rankWithGraph({
      candidates: [
        cand("syntra.undocumented", 1, [], false),
        cand("syntra.wrong.fields", 0, ["somethingElse"]),
      ],
      emittedByGraph: [],
      firstStepRequires: ["jobId"],
    });
    // Undocumented ranks above an event proven to carry the wrong thing.
    expect(out[0]!.eventType).toBe("syntra.undocumented");
    expect(out[0]!.satisfies).toBeNull();
    expect(out[0]!.why).toContain("not described");
    expect(out[1]!.satisfies).toBe(0);
  });

  it("says so when the step declares no inputs at all", () => {
    const out = rankWithGraph({
      candidates: [cand("syntra.jd.received", 0, ["jobId"])],
      emittedByGraph: [],
      firstStepRequires: [],
      firstStepAccepts: [],
    });
    expect(out[0]!.satisfies).toBeNull();
    expect(out[0]!.why).toContain("declares no inputs");
  });

  /**
   * The case that makes the ranking work at all.
   *
   * Eight of the nine SYNTRA nodes state their requirement as a zod .refine —
   * "candidateId or candidate_id" — and z.toJSONSchema drops .refine silently,
   * so the registry required array is empty for every one of them. Ranking on
   * required alone therefore measured nothing 8 times out of 9 and fell back to
   * word overlap, which is how syntra.bench.alert came to be triggered on
   * syntra.match.completed.
   *
   * The property list survives, and separates them cleanly: of eleven SYNTRA
   * events only profile.prepared and resume.received carry any name
   * bench.alert reads.
   */
  it("uses what the step ACCEPTS when it marks nothing required", () => {
    const out = rankWithGraph({
      candidates: [
        // Real payloads, from the catalogue.
        cand("syntra.match.completed", 0, ["jobId", "match_job_id", "result_count"]),
        cand("syntra.profile.prepared", 1, ["candidate_id", "candidate_profile_id"]),
      ],
      emittedByGraph: [],
      firstStepRequires: [],
      firstStepAccepts: [
        "resumeId",
        "candidateId",
        "document_id",
        "candidate_id",
        "candidate_profile_id",
      ],
      firstStepImpl: "syntra.bench.alert",
    });
    expect(out[0]!.eventType).toBe("syntra.profile.prepared");
    expect(out[0]!.why).toContain("candidate_id");
    expect(out[1]!.why).toContain("carries nothing");
  });

  it("prefers required over accepts when the step declares both", () => {
    const out = rankWithGraph({
      candidates: [
        cand("has-accepted-only", 0, ["candidateId"]),
        cand("has-required", 1, ["resumeId"]),
      ],
      emittedByGraph: [],
      firstStepRequires: ["resumeId"],
      firstStepAccepts: ["resumeId", "candidateId"],
      firstStepImpl: "syntra.match.process",
    });
    expect(out[0]!.eventType).toBe("has-required");
    expect(out[0]!.satisfies).toBe(1);
  });

  it("ranks a partial fit between a full one and none", () => {
    const out = rankWithGraph({
      candidates: [
        cand("none", 0, ["unrelated"]),
        cand("half", 1, ["jobId"]),
        cand("full", 2, ["jobId", "resumeId"]),
      ],
      emittedByGraph: [],
      firstStepRequires: ["jobId", "resumeId"],
    });
    expect(out.map((c) => c.eventType)).toEqual(["full", "half", "none"]);
    expect(out[1]!.why).toContain("50%");
  });

  it("still returns every candidate, including the excluded one", () => {
    // Ordered last, never dropped. An author who disagrees has to be able to
    // see it and pick it, and the ledger has to be able to say why it lost.
    const out = rankWithGraph({
      candidates: [cand("a", 0), cand("b", 1)],
      emittedByGraph: ["a", "b"],
      firstStepRequires: [],
    });
    expect(out).toHaveLength(2);
    expect(out.every((c) => c.selfTriggering)).toBe(true);
  });

  it("survives an empty candidate list", () => {
    expect(
      rankWithGraph({
        candidates: [],
        emittedByGraph: [],
        firstStepRequires: ["jobId"],
      }),
    ).toEqual([]);
  });
});
