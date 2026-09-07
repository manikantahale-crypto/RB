/**
 * Trigger ranking — the pure half of screen 2's proposal.
 *
 * These cover the parts that fail QUIETLY. A wrong trigger does not throw and
 * does not fail a run; the workflow is simply never started by anything, and
 * nobody finds out until they ask why nothing happened. That is the whole
 * reason this ranking is deterministic, and the reason it is worth tests:
 * every regression below was a real defect at some point in this file's life.
 */
import { describe, expect, it } from "vitest";
import {
  compareCandidates,
  detectHandoff,
  keepYourHalf,
  idfOver,
  requestWeights,
  scoreEvent,
  singular,
  splitRequest,
  terms,
  whyBelow,
} from "./propose.js";

/**
 * A catalogue standing in for the real 26 rows.
 *
 * The FOUR `astra.requirement.*` entries are load-bearing, not padding. The
 * real catalogue has a cluster of them, which is what makes "requirement" a
 * common word and therefore a weak signal. A fixture with one of each event
 * gives every word the same rarity and quietly stops testing the weighting at
 * all — which is exactly what this fixture did on its first draft.
 */
const CATALOGUE = [
  {
    eventType: "astra.requirement.received",
    description: "ASTRA requirement intake received",
    producedWhen: "ASTRA channel / ingest created a JD row",
  },
  {
    eventType: "astra.requirement.normalized",
    description: "ASTRA requirement normalized",
    producedWhen: "astra.requirement.normalize completed",
  },
  {
    eventType: "astra.requirement.scored",
    description: "ASTRA requirement scored for quality",
    producedWhen: "astra.requirement.quality completed",
  },
  {
    eventType: "astra.requirement.rejected",
    description: "ASTRA requirement rejected",
    producedWhen: "ASTRA route decision failed the actionable gate",
  },
  {
    eventType: "syntra.match.completed",
    description: "A job and resume match finished scoring",
    producedWhen: "Syntra finished a match run",
  },
  {
    eventType: "syntra.match.requested",
    description: "A job by resume match was requested",
    producedWhen: "Syntra or platform ingress asked for a match",
  },
  {
    eventType: "syntra.duplicate.review_required",
    description: "Probable duplicate detected, human review required",
    producedWhen: "Duplicate detection was not confident enough to merge",
  },
];

const corpus = CATALOGUE.map((e) => [
  ...terms(e.eventType),
  ...terms(e.description),
  ...terms(e.producedWhen),
]);
const idf = idfOver(corpus);

function rank(description: string) {
  const request = requestWeights(description);
  return CATALOGUE.map((e) => ({
    eventType: e.eventType,
    ...scoreEvent(request, e, idf, corpus.length),
  })).sort((a, b) => b.score - a.score);
}

describe("singular", () => {
  it("strips a plural -s so 'candidates' can reach 'candidate'", () => {
    // The bug this replaced turned "candidates" into "candidat" while leaving
    // "candidate" whole, so the two never matched each other.
    expect(singular("candidates")).toBe("candidate");
    expect(singular("requirements")).toBe("requirement");
  });

  it("strips -es only after a sibilant", () => {
    expect(singular("matches")).toBe("match");
    expect(singular("boxes")).toBe("box");
  });

  it("leaves words that merely end in s alone", () => {
    expect(singular("process")).toBe("process");
    expect(singular("status")).toBe("status");
  });
});

describe("stop words", () => {
  it("keeps domain verbs in the vocabulary", () => {
    // `match` was previously deleted outright, which made the most-published
    // event in the catalogue unreachable by any description that said "match".
    expect(terms("match the candidates")).toContain("match");
  });

  it("still drops grammar", () => {
    expect(terms("when the a and or")).toEqual([]);
  });
});

describe("splitRequest", () => {
  it("treats the clause after 'when' as the trigger", () => {
    const { lead, rest } = splitRequest(
      "When a requirement finishes intake, match it against our candidates.",
    );
    expect(lead).toBe("When a requirement finishes intake");
    expect(rest).toContain("match it against our candidates");
  });

  it("falls back to the first sentence when nobody writes 'when'", () => {
    const { lead } = splitRequest("A requirement lands. Then we match it.");
    expect(lead).toBe("A requirement lands");
  });
});

describe("requestWeights", () => {
  it("weights the trigger clause above the body", () => {
    const w = requestWeights(
      "When a requirement finishes intake, match it against our candidates.",
    );
    expect(w.get("intake")).toBe(2);
    expect(w.get("match")).toBe(1);
  });

  it("gives a word in both clauses the higher weight", () => {
    const w = requestWeights("When a match completes, record the match.");
    expect(w.get("match")).toBe(2);
  });
});

describe("idfOver", () => {
  it("scores a word used everywhere below one used once", () => {
    const common = idf.get("match")!;
    const rare = idf.get("duplicate")!;
    expect(rare).toBeGreaterThan(common);
  });

  it("never returns zero, so a common word still counts for something", () => {
    for (const v of idf.values()) expect(v).toBeGreaterThan(0);
  });
});

describe("ranking a request", () => {
  it("picks the trigger, not the action the workflow performs", () => {
    // The regression this guards: "match" is the loudest word in the sentence
    // but describes the body. Weighting the "when…" clause is what keeps the
    // intake event on top.
    const [top] = rank(
      "When a new job requirement arrives and finishes intake, match it against our available candidates.",
    );
    expect(top!.eventType).toBe("astra.requirement.received");
  });

  it("picks the match event when matching genuinely is the trigger", () => {
    // The opposite case, impossible while `match` was a stop word.
    const [top] = rank(
      "When a candidate match completes, notify the recruiter who owns the shortlist.",
    );
    expect(top!.eventType).toBe("syntra.match.completed");
  });

  it("cites the distinctive words first", () => {
    const [top] = rank("When a requirement finishes intake, score it.");
    // "intake" distinguishes; "requirement" appears all over the catalogue.
    expect(top!.matchedOn[0]).toBe("intake");
  });
});

describe("compareCandidates", () => {
  const base = {
    description: "",
    producedWhen: "",
    matchedOn: ["requirement"],
    // Most events describe themselves; the ones that do not are the exception
    // and each test below says so explicitly.
    declaresPayload: true,
  };

  it("puts a live event above a dead one on an equal score", () => {
    // The original defect: equal scores fell through to the order rows arrived
    // in, which was alphabetical, so `astra.*` always beat `syntra.*`.
    const dead = { ...base, eventType: "zzz.dead", score: 1, publishCount: 0, everPublished: false };
    const live = { ...base, eventType: "aaa.live", score: 1, publishCount: 900, everPublished: true };
    expect([dead, live].sort(compareCandidates)[0]!.eventType).toBe("aaa.live");
  });

  it("still lets a much better match win despite never having fired", () => {
    // Liveness is a weight, not an exclusion. An event registered minutes ago
    // is a legitimate thing to trigger on.
    const fresh = { ...base, eventType: "new.event", score: 1, publishCount: 0, everPublished: false };
    const weak = { ...base, eventType: "old.event", score: 0.2, publishCount: 900, everPublished: true };
    expect([weak, fresh].sort(compareCandidates)[0]!.eventType).toBe("new.event");
  });

  it("is stable for two identical candidates", () => {
    const a = { ...base, eventType: "a.one", score: 1, publishCount: 5, everPublished: true };
    const b = { ...base, eventType: "b.two", score: 1, publishCount: 5, everPublished: true };
    expect(compareCandidates(a, b)).toBeLessThan(0);
  });
});

describe("whyBelow", () => {
  const live = (eventType: string, matchedOn: string[], publishCount = 10) => ({
    eventType,
    description: "",
    producedWhen: "",
    score: 1,
    matchedOn,
    publishCount,
    everPublished: publishCount > 0,
  });

  it("leads with the fact that nothing publishes it", () => {
    const reason = whyBelow(live("a", ["x"]), live("b", ["x"], 0));
    expect(reason).toContain("never run");
  });

  it("names the word the loser's entry does not use", () => {
    // Replaces a fallback that said "ranked lower on word overlap alone",
    // which gave a reader nothing to act on.
    const reason = whyBelow(live("a", ["intake", "requirement"]), live("b", ["requirement"]));
    expect(reason).toContain('"intake"');
  });
});
/* ─────────────────────────────── the seam ──────────────────────────────── */

/**
 * The live cross-application case, in miniature.
 *
 * ASTRA owns intake and publishes `syntra.jd.normalized`; SYNTRA owns matching
 * and starts from that event. A generator that does not know the boundary
 * exists returns both halves as one graph, which is the thing being detected.
 */
const OWNERS = new Map<string, string>([
  ["astra.requirement.quality", "astra"],
  ["astra.route.decision", "astra"],
  ["syntra.match.process", "syntra"],
  ["syntra.shortlist.notify", "syntra"],
  ["orch.branch.decision", "platform"],
  ["human.gate", "platform"],
]);
/** Platform nodes are lent to everyone — borrowing one is not a seam. */
const SHAREABLE = new Set(["orch.branch.decision", "human.gate"]);
const EVENTS = new Set([
  "syntra.jd.normalized",
  "astra.requirement.received",
  "astra.requirement.rejected",
]);

/** intake (astra) → route (astra, emits) → match (syntra) */
const mixed = {
  nodes: [
    { id: "quality", impl: "astra.requirement.quality" },
    { id: "gate", impl: "human.gate" },
    {
      id: "route",
      impl: "astra.route.decision",
      config: {
        onActionable: "syntra.jd.normalized",
        onRejected: "astra.requirement.rejected",
        minConfidence: 0,
      },
    },
    { id: "match", impl: "syntra.match.process", config: { matchThreshold: 92 } },
  ],
  edges: [
    ["__start__", "quality"],
    ["quality", "gate"],
    ["gate", "route"],
    ["route", "match"],
    ["match", "__end__"],
  ] as Array<[string, string]>,
};

const detect = (module: string, g = mixed) =>
  detectHandoff({
    module,
    nodes: g.nodes,
    edges: g.edges,
    moduleOf: OWNERS,
    shareable: SHAREABLE,
    eventTypes: EVENTS,
  });

describe("detectHandoff", () => {
  it("says nothing about a single-owner graph", () => {
    expect(detect("astra", {
      nodes: [
        { id: "quality", impl: "astra.requirement.quality" },
        { id: "gate", impl: "human.gate" },
      ],
      edges: [["__start__", "quality"], ["quality", "gate"], ["gate", "__end__"]],
    })).toBeNull();
  });

  it("finds the boundary for a SYNTRA author, whose half runs second", () => {
    const h = detect("syntra");
    expect(h).not.toBeNull();
    expect(h!.otherModule).toBe("astra");
    expect(h!.yourHalf).toBe("after");
    expect(h!.yourSteps).toEqual(["match"]);
    // The borrowed platform gate goes with the half it SITS IN, not with the
    // author — it is running inside ASTRA's sequence.
    expect(h!.theirSteps).toEqual(["quality", "gate", "route"]);
  });

  it("reads the handoff event out of the emitting step's config", () => {
    expect(detect("syntra")!.viaEvent).toBe("syntra.jd.normalized");
    // Same graph, other author: the emitting half is now theirs, and the
    // event is still the one that joins them.
    expect(detect("astra")!.viaEvent).toBe("syntra.jd.normalized");
  });

  it("puts the halves the right way round for an ASTRA author", () => {
    const h = detect("astra")!;
    expect(h.yourHalf).toBe("before");
    expect(h.yourSteps).toEqual(["quality", "gate", "route"]);
    expect(h.theirSteps).toEqual(["match"]);
  });

  it("reports no event when nothing names one", () => {
    const h = detect("syntra", {
      nodes: [
        { id: "quality", impl: "astra.requirement.quality" },
        { id: "match", impl: "syntra.match.process" },
      ],
      edges: [
        ["__start__", "quality"],
        ["quality", "match"],
        ["match", "__end__"],
      ],
    })!;
    expect(h.viaEvent).toBeNull();
    expect(h.otherModule).toBe("astra");
  });

  it("does not call a graph that is entirely theirs a handoff", () => {
    // Nothing of yours to keep, so "split this in two" would be the wrong
    // thing to say — the request belongs to them outright.
    expect(
      detect("syntra", {
        nodes: [{ id: "quality", impl: "astra.requirement.quality" }],
        edges: [["__start__", "quality"], ["quality", "__end__"]],
      }),
    ).toBeNull();
  });

  it("ignores a borrowed shareable node even when it is the only foreigner", () => {
    expect(
      detect("syntra", {
        nodes: [
          { id: "gate", impl: "human.gate" },
          { id: "match", impl: "syntra.match.process" },
        ],
        edges: [["__start__", "gate"], ["gate", "match"], ["match", "__end__"]],
      }),
    ).toBeNull();
  });
});

describe("keepYourHalf", () => {
  it("drops their steps and re-chains what is left", () => {
    const h = detect("astra")!;
    const kept = keepYourHalf(mixed.nodes, h.yourSteps);
    expect(kept.nodes.map((n) => n.id)).toEqual(["quality", "gate", "route"]);
    expect(kept.edges).toEqual([
      ["__start__", "quality"],
      ["quality", "gate"],
      ["gate", "route"],
      ["route", "__end__"],
    ]);
  });

  it("keeps the config a person wrote down", () => {
    const h = detect("syntra")!;
    const kept = keepYourHalf(mixed.nodes, h.yourSteps);
    expect(kept.nodes[0]?.config).toEqual({ matchThreshold: 92 });
    expect(kept.edges).toEqual([
      ["__start__", "match"],
      ["match", "__end__"],
    ]);
  });
});

describe("an event that does not describe itself", () => {
  const base = {
    description: "",
    producedWhen: "",
    matchedOn: ["job", "match"],
    declaresPayload: true,
  };

  it("loses to one that does, on an equal score", () => {
    // The real case: for "when a job requirement arrives and finishes intake,
    // match it against our candidates", ASTRA_JOB_MATCH_DISCOVERED wins on the
    // words JOB and MATCH — a legacy event with an empty schema, so the
    // workflow it starts can never have its inputs checked.
    const vague = {
      ...base,
      eventType: "ASTRA_JOB_MATCH_DISCOVERED",
      score: 1,
      publishCount: 253,
      everPublished: true,
      declaresPayload: false,
    };
    const described = {
      ...base,
      eventType: "astra.requirement.received",
      score: 1,
      publishCount: 1500,
      everPublished: true,
    };
    expect([vague, described].sort(compareCandidates)[0]!.eventType).toBe(
      "astra.requirement.received",
    );
  });

  it("is still offered when it is the only thing that matches", () => {
    // Halved, never excluded — sometimes it genuinely is the only door.
    const vague = {
      ...base,
      eventType: "ASTRA_JOB_MATCH_DISCOVERED",
      score: 1,
      publishCount: 253,
      everPublished: true,
      declaresPayload: false,
    };
    const unrelated = {
      ...base,
      eventType: "orbit.placement.confirmed",
      score: 0.1,
      publishCount: 10,
      everPublished: true,
    };
    expect([unrelated, vague].sort(compareCandidates)[0]!.eventType).toBe(
      "ASTRA_JOB_MATCH_DISCOVERED",
    );
  });
});
