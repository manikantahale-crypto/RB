/**
 * What the model's score may not exceed, given what the requirement said.
 *
 * Tier 3 scores two summaries. The model does not see which skills the
 * requirement called mandatory, so it can say 88 for a candidate who lacks
 * the one skill the role cannot do without. These caps are the rules a
 * recruiter would apply by hand, applied by the application, and named on
 * the row (evidence.caps_applied) so a lowered score is explainable.
 *
 * Taken from the other branch's matchScoreCaps.js (2026-09-18) with two
 * rules left out on purpose: its "unrelated domain" cap read the model's own
 * breakdown to cap the model (circular), and its harmonise step blended the
 * two scores with hand-tuned weights nothing here can justify. What stays
 * is deterministic and evidence-backed: the requirement's own skill lists
 * against the candidate's, through the same overlap tier 2 uses.
 *
 * Every threshold is an env knob with the other branch's default.
 *
 * ADVISORY UNTIL THE LISTS ARE TRUSTED. The first real proof (2026-09-20,
 * "SAP ABAP Developer" against an 8-year ABAP consultant) had the model at
 * 90 and this file at 35: the requirement's mandatory list read
 * ["sql","sap","abap","go","data"], and "go" and "data" are noise from an
 * old extraction, not skills. A cap is only as good as the list it reads.
 * So until MATCH_SCORE_CAPS=on, the caps are COMPUTED and RECORDED
 * (evidence.caps_advisory) but not applied — which is how we will know, from
 * the rows, how often they would fire and on what, before they change a
 * score a recruiter sees.
 */
const { skillMatchScore, hasSkillEvidence } = require("./tier2Rank");

function asList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function positiveInt(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** Read once per call so a test can set the environment. */
function limits(env = process.env) {
  return {
    /** "on" applies the caps to `score`; anything else records them only. */
    enforce: String(env.MATCH_SCORE_CAPS || "off").toLowerCase() === "on",
    /** A candidate missing any mandatory skill scores at most this. */
    missingMandatoryMax: positiveInt(env.MATCH_MAX_MISSING_MANDATORY_SCORE, 35),
    /** Required-skill coverage (%) below which the low-coverage cap applies. */
    lowCoverageBelow: positiveInt(env.MATCH_LOW_REQUIRED_COVERAGE_THRESHOLD, 30),
    /** … and what such a candidate scores at most. */
    lowCoverageMax: positiveInt(env.MATCH_MAX_LOW_REQUIRED_SKILL_SCORE, 40),
  };
}

/**
 * The evidence tier 2 can give about one pair. Coverage is null when the
 * requirement names nothing on that list — absence, not zero.
 */
function skillEvidence({ requiredSkills, mandatorySkills, candidateSkills }) {
  const required = asList(requiredSkills);
  const mandatory = asList(mandatorySkills);
  const candidate = asList(candidateSkills);
  const requiredCoverage = hasSkillEvidence(required) ? skillMatchScore(required, candidate) : null;
  const mandatoryCoverage = hasSkillEvidence(mandatory) ? skillMatchScore(mandatory, candidate) : null;
  return { requiredCoverage, mandatoryCoverage, mandatoryCount: mandatory.length };
}

/**
 * The model's score, capped where the requirement's own lists say it must
 * be. Returns the final score, the raw one, which rules applied, and the
 * word for how the score was reached (score_source).
 */
function applyScoreCaps({ llmScore, evidence, env }) {
  const l = limits(env);
  const raw = Math.max(0, Math.min(100, Math.round(Number(llmScore) || 0)));
  let score = raw;
  const capsApplied = [];

  if (evidence.mandatoryCoverage != null && evidence.mandatoryCoverage < 100 && score > l.missingMandatoryMax) {
    capsApplied.push(`missing_mandatory:${l.missingMandatoryMax}`);
    score = l.missingMandatoryMax;
  }
  if (evidence.requiredCoverage != null && evidence.requiredCoverage < l.lowCoverageBelow && score > l.lowCoverageMax) {
    capsApplied.push(`low_required_coverage:${l.lowCoverageMax}`);
    score = l.lowCoverageMax;
  }

  if (!l.enforce) {
    return {
      score: raw,
      llmScore: raw,
      capsApplied: [],
      capsAdvisory: capsApplied,
      scoreSource: "llm",
    };
  }
  return {
    score,
    llmScore: raw,
    capsApplied,
    capsAdvisory: [],
    scoreSource: capsApplied.length ? "llm_capped" : "llm",
  };
}

module.exports = { skillEvidence, applyScoreCaps, limits };
