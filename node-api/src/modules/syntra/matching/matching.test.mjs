/**
 * The pure halves of matching, pinned as production runs them.
 *
 * Tier 2's overlap, the role-family gate and the JSON repair were ported from
 * the deployed branch on 2026-09-20 (ref/SYNTRA_Matching_Study.md). These
 * say what each one does with the inputs the data actually has — skills
 * spelt three ways, titles that name a family, a model answer cut off
 * mid-string — so a later change is a decision, not a drift.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { skillMatchScore, rankCandidates, rankJobsForResume, hasSkillEvidence } = require("./tier2Rank");
const { roleFamily, rolesCompatible, toPercentScore } = require("./roleFit");
const { safeJsonParse } = require("../../../utils/jsonParser");
const { skillEvidence, applyScoreCaps } = require("./scoreCaps");

describe("tier 2 — skill overlap", () => {
  it("matches spellings that are not identical: case, punctuation, a longer name", () => {
    expect(skillMatchScore(["PostgreSQL", "Node.js"], ["postgresql", "node js developer"])).toBe(100);
    expect(skillMatchScore(["OOPS"], ["oop"])).toBe(100);
  });

  it("still misses a spelling that drops the space — the limit of substring overlap", () => {
    // "Node.js" normalises to "node js"; "nodejs" has no space, so no hit. And
    // "aws" is three letters, below the substring floor. Production behaves
    // this way today; the other branch's skillCanonicalization is the answer
    // if real pairs are lost to it (study §3).
    expect(skillMatchScore(["Node.js", "PostgreSQL", "AWS"], ["nodejs", "postgresql", "aws lambda"])).toBe(33);
  });

  it("does not let a short token match everything", () => {
    // "c" is inside "react"; 3 letters never substring-match
    expect(skillMatchScore(["C"], ["react"])).toBe(0);
  });

  it("scores 0 when the requirement names no skills — which is 84 % of them today", () => {
    expect(skillMatchScore([], ["java", "spring"])).toBe(0);
    expect(skillMatchScore(null, ["java"])).toBe(0);
    expect(skillMatchScore("not json", ["java"])).toBe(0);
  });

  it("reads a JSON string for skills as the column sometimes holds", () => {
    expect(skillMatchScore('["java","spring"]', '["Java"]')).toBe(50);
  });

  it("ranks, cuts at the floor and caps at topN, reporting the cut", () => {
    const r = rankCandidates({
      requiredSkills: ["java", "spring", "sql"],
      candidates: [
        { resume_id: "a", candidate_id: "A", skills: ["java", "spring", "sql"] },
        { resume_id: "b", candidate_id: "B", skills: ["java"] },
        { resume_id: "c", candidate_id: "C", skills: ["python"] },
      ],
      skillFloor: 30,
      topN: 1,
    });
    expect(r.finalists.map((f) => f.resumeId)).toEqual(["a"]);
    expect(r.gateCut).toBe(2); // one below the floor, one over topN
  });
});

describe("tier 2 — a requirement that names no skills", () => {
  const candidates = [
    { resume_id: "a", candidate_id: "A", skills: ["java"] },
    { resume_id: "b", candidate_id: "B", skills: ["python"] },
    { resume_id: "c", candidate_id: "C", skills: [] },
  ];

  it("is not a zero: nobody is cut by the floor, tier-1 order stands, topN applies", () => {
    for (const none of [[], null, undefined, "[]"]) {
      const r = rankCandidates({ requiredSkills: none, candidates, skillFloor: 50, topN: 2 });
      expect(r.noSkillEvidence).toBe(true);
      expect(r.finalists.map((f) => f.resumeId)).toEqual(["a", "b"]);
      expect(r.finalists.every((f) => f.noSkillEvidence)).toBe(true);
      expect(r.gateCut).toBe(1); // only topN cut anyone
    }
    expect(hasSkillEvidence(["java"])).toBe(true);
    expect(hasSkillEvidence(["", " "])).toBe(false);
  });

  it("with skills, the floor still cuts and the flag is off", () => {
    const r = rankCandidates({ requiredSkills: ["java"], candidates, skillFloor: 50, topN: 5 });
    expect(r.noSkillEvidence).toBe(false);
    expect(r.finalists.map((f) => f.resumeId)).toEqual(["a"]);
  });

  it("resume → jobs: a job with no skills is kept but ranks after every job that earned a score", () => {
    const r = rankJobsForResume({
      resumeSkills: ["java", "spring"],
      jobs: [
        { job_id: "none", resume_id: "r", candidate_id: "C", required_skills: [] },
        { job_id: "weak", resume_id: "r", candidate_id: "C", required_skills: ["java", "go", "rust"] },
        { job_id: "good", resume_id: "r", candidate_id: "C", required_skills: ["java", "spring"] },
      ],
      skillFloor: 40,
      topN: 5,
    });
    expect(r.finalists.map((f) => f.jobId)).toEqual(["good", "none"]);
    expect(r.gateCut).toBe(1); // "weak" scored 33 and was cut; "none" was not judged
  });
});

describe("tier 1 — role families", () => {
  it("names the family from a title, and a Product Manager is not a Finance Manager", () => {
    expect(roleFamily(["Senior Product Manager"])).toBe("product");
    expect(roleFamily(["FP&A Analyst"])).toBe("finance");
    expect(rolesCompatible(["Product Manager"], ["Finance Manager", null, "Jane Doe"])).toBe(false);
  });

  it("lets an unknown family through — the gate only drops a clear mismatch", () => {
    expect(rolesCompatible(["SAP ABAP Developer"], ["SAP Consultant"])).toBe(true);
    expect(rolesCompatible([], ["anything"])).toBe(true);
    expect(rolesCompatible(["Software Engineer"], ["Backend Developer"])).toBe(true);
  });

  it("turns a model's 0–1 or 0–100 score into a percentage", () => {
    expect(toPercentScore(0.82)).toBe(82);
    expect(toPercentScore(82)).toBe(82);
    expect(toPercentScore(140)).toBe(100);
    expect(toPercentScore("x")).toBe(0);
  });
});

describe("safeJsonParse — what a model actually returns", () => {
  it("strips fences and surrounding prose", () => {
    expect(safeJsonParse('Sure! ```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("repairs an answer cut off by max_tokens", () => {
    expect(safeJsonParse('{"results":[{"candidate_id":"c1","match_score":71,"gaps":["sq')).toEqual({
      results: [{ candidate_id: "c1", match_score: 71, gaps: ["sq"] }],
    });
  });

  it("refuses when there is no object at all", () => {
    expect(() => safeJsonParse("no json here")).toThrow(/missing opening/);
  });
});

describe("score caps — what the model's score may not exceed", () => {
  const ev = (o) => skillEvidence({ requiredSkills: ["java", "spring", "sql", "kafka"], mandatorySkills: ["java"], candidateSkills: o });

  const on = { MATCH_SCORE_CAPS: "on" };

  it("is the model's score, untouched, when the evidence holds up", () => {
    const r = applyScoreCaps({ llmScore: 88, evidence: ev(["java", "spring", "sql"]), env: on });
    expect(r).toEqual({ score: 88, llmScore: 88, capsApplied: [], capsAdvisory: [], scoreSource: "llm" });
  });

  it("is advisory by default: the cap is recorded, the score is not touched", () => {
    // The first real proof had a strong ABAP consultant capped 90 → 35 by a
    // mandatory list containing "go" and "data" — noise, not skills.
    const r = applyScoreCaps({ llmScore: 90, evidence: ev(["spring", "sql", "kafka"]) });
    expect(r).toEqual({ score: 90, llmScore: 90, capsApplied: [], capsAdvisory: ["missing_mandatory:35"], scoreSource: "llm" });
  });

  it("caps a candidate missing a mandatory skill when enforced, and says so", () => {
    const r = applyScoreCaps({ llmScore: 88, evidence: ev(["spring", "sql", "kafka"]), env: on });
    expect(r.score).toBe(35);
    expect(r.llmScore).toBe(88);
    expect(r.scoreSource).toBe("llm_capped");
    expect(r.capsApplied).toEqual(["missing_mandatory:35"]);
  });

  it("caps low required-skill coverage", () => {
    const r = applyScoreCaps({ llmScore: 70, evidence: ev(["java"]), env: on }); // 1 of 4 = 25 % < 30
    expect(r.score).toBe(40);
    expect(r.capsApplied).toEqual(["low_required_coverage:40"]);
  });

  it("never raises a score, and a requirement that names nothing caps nothing", () => {
    expect(applyScoreCaps({ llmScore: 20, evidence: ev([]), env: on }).score).toBe(20);
    const none = skillEvidence({ requiredSkills: [], mandatorySkills: null, candidateSkills: ["java"] });
    expect(none).toEqual({ requiredCoverage: null, mandatoryCoverage: null, mandatoryCount: 0 });
    expect(applyScoreCaps({ llmScore: 91, evidence: none, env: on })).toMatchObject({ score: 91, scoreSource: "llm" });
  });

  it("reads its thresholds from the environment", () => {
    const r = applyScoreCaps({
      llmScore: 88,
      evidence: ev(["spring", "sql", "kafka"]),
      env: { MATCH_SCORE_CAPS: "on", MATCH_MAX_MISSING_MANDATORY_SCORE: "50" },
    });
    expect(r.score).toBe(50);
  });
});

/**
 * The reconcile that brought the stack down, twice.
 *
 * It re-ran the FULL funnel for every surviving job — ~1,700 of them, nine
 * seconds each, inline, inside a request that times out at five minutes.
 * Moving those to the queue removed the timeout and kept the number: 4,300
 * jobs climbing at 190 a minute against a drain of 30.
 *
 * Neither was necessary. `rankJobsForResume` has already scored this resume
 * against every surviving job — `aboveFloor` holds them in score order — so
 * the pairs wanted are simply the ones past `topN`. No funnel re-runs, no
 * queue messages, no fan-out.
 */
const { pairsNeedingReconcile } = require("./funnel");

const AT = (iso) => new Date(iso).toISOString();
const RESUME_READY = AT("2026-09-22T12:00:00Z");
const resume = { processed_at: RESUME_READY };
const BEFORE = AT("2026-09-22T11:00:00Z");
const AFTER = AT("2026-09-22T13:00:00Z");

/** `aboveFloor` from rankJobsForResume — scored, sorted, best first. */
const scoredJobs = (...ids) =>
  ids.map((jobId, i) => ({ jobId, candidateId: "c-1", skillMatchScore: 90 - i }));
const survivorsAt = (when, ...ids) =>
  ids.map((job_id) => ({ job_id, job_processed_at: when }));

describe("the pairs a resume still needs, beyond its own top N", () => {
  it("skips the top N — those already have a row from the shortlist", () => {
    const ids = ["a", "b", "c"];
    const out = pairsNeedingReconcile(
      scoredJobs(...ids), resume, survivorsAt(BEFORE, ...ids), 2, 25,
    );
    expect(out.map((p) => p.jobId)).toEqual(["c"]);
  });

  it("carries the score through, so no funnel has to rediscover it", () => {
    // The whole point: the pair was scored moments ago. Re-running the job's
    // funnel to learn it again was the original mistake.
    const out = pairsNeedingReconcile(
      scoredJobs("a", "b"), resume, survivorsAt(BEFORE, "a", "b"), 0, 25,
    );
    expect(out[0]).toMatchObject({ jobId: "a", skillMatchScore: 90, candidateId: "c-1" });
  });

  it("includes a job whose funnel ran before this resume was matchable", () => {
    expect(
      pairsNeedingReconcile(scoredJobs("j-old"), resume, survivorsAt(BEFORE, "j-old"), 0, 25)
        .map((p) => p.jobId),
    ).toEqual(["j-old"]);
  });

  it("skips a job whose funnel ran after — it already considered this resume", () => {
    expect(
      pairsNeedingReconcile(scoredJobs("j-new"), resume, survivorsAt(AFTER, "j-new"), 0, 25),
    ).toEqual([]);
  });

  it("skips a job processed at the same instant, which saw it", () => {
    expect(
      pairsNeedingReconcile(scoredJobs("j-tie"), resume, survivorsAt(RESUME_READY, "j-tie"), 0, 25),
    ).toEqual([]);
  });

  it("is conservative when either timestamp is missing", () => {
    // No evidence the job's funnel saw this resume, and missing a pairing is
    // worse than one extra row.
    expect(
      pairsNeedingReconcile(scoredJobs("j-1"), resume, [{ job_id: "j-1" }], 0, 25)
        .map((p) => p.jobId),
    ).toEqual(["j-1"]);
    expect(
      pairsNeedingReconcile(scoredJobs("j-2"), {}, survivorsAt(AFTER, "j-2"), 0, 25)
        .map((p) => p.jobId),
    ).toEqual(["j-2"]);
  });

  it("STOPS AT THE CAP — 3,416 requirements nearly all predate any new resume", () => {
    const ids = Array.from({ length: 1700 }, (_, i) => `j-${i}`);
    const out = pairsNeedingReconcile(
      scoredJobs(...ids), resume, survivorsAt(BEFORE, ...ids), 15, 25,
    );
    expect(out).toHaveLength(25);
  });

  it("takes them in score order, because aboveFloor arrives sorted", () => {
    const ids = ["best", "next", "third", "fourth"];
    expect(
      pairsNeedingReconcile(scoredJobs(...ids), resume, survivorsAt(BEFORE, ...ids), 0, 2)
        .map((p) => p.jobId),
    ).toEqual(["best", "next"]);
  });

  it("counts only what it keeps toward the cap, not what it skips", () => {
    const survivors = [
      ...survivorsAt(AFTER, "seen-1", "seen-2"),
      ...survivorsAt(BEFORE, "stale-1", "stale-2"),
    ];
    expect(
      pairsNeedingReconcile(
        scoredJobs("seen-1", "seen-2", "stale-1", "stale-2"), resume, survivors, 0, 2,
      ).map((p) => p.jobId),
    ).toEqual(["stale-1", "stale-2"]);
  });

  it("returns each job once, however many rows it arrived on", () => {
    // A job reaches the pool from both the role query and the vector query.
    expect(
      pairsNeedingReconcile(
        scoredJobs("j-1", "j-1", "j-2"), resume, survivorsAt(BEFORE, "j-1", "j-1", "j-2"), 0, 25,
      ).map((p) => p.jobId),
    ).toEqual(["j-1", "j-2"]);
  });

  it("copes with nothing to reconcile at all", () => {
    expect(pairsNeedingReconcile([], resume, [], 0, 25)).toEqual([]);
    expect(pairsNeedingReconcile(undefined, resume, undefined, 0, 25)).toEqual([]);
    expect(
      pairsNeedingReconcile(scoredJobs("j-1"), resume, survivorsAt(BEFORE, "j-1"), 0, 0),
    ).toEqual([]);
  });
});
