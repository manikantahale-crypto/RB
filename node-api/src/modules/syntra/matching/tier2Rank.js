/**
 * Tier 2 — skill overlap rank + threshold gate (0 LLM).
 */

function asSkillList(value) {
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

function normalizeSkill(skill) {
  return String(skill)
    .trim()
    .toLowerCase()
    .replace(/oops/g, "oop")
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function skillOverlapHit(required, candidateSet) {
  if (candidateSet.has(required)) return true;
  if (required.length < 4) return false;
  for (const cand of candidateSet) {
    if (cand.length < 4) continue;
    if (cand.includes(required) || required.includes(cand)) return true;
  }
  return false;
}

function skillMatchScore(requiredSkills, candidateSkills) {
  const required = asSkillList(requiredSkills).map(normalizeSkill).filter(Boolean);
  const candidate = new Set(
    asSkillList(candidateSkills).map(normalizeSkill).filter(Boolean)
  );

  const uniqueRequired = [...new Set(required)];
  if (uniqueRequired.length === 0) return 0;

  const overlapCount = uniqueRequired.filter((s) => skillOverlapHit(s, candidate)).length;
  return Math.round((overlapCount / uniqueRequired.length) * 100);
}

/**
 * @param {object} opts
 * @param {string[]} opts.requiredSkills
 * @param {Array<{ resume_id: string, candidate_id: string, skills: any }>} opts.candidates
 * @param {number} opts.skillFloor
 * @param {number} opts.topN
 */
/**
 * A requirement that names no skills gives tier 2 nothing to judge by.
 *
 * It used to score every candidate 0 and the floor cut all of them: at any
 * threshold above zero the funnel ended with nobody, and nothing said why.
 * 2,818 processed requirements were in that state on 2026-09-20 — the AI
 * extraction had failed and been recorded as a success (see
 * astraIntelligence.service.js). Those are being re-extracted; until every
 * one is, and for any requirement whose text genuinely names no skills:
 *
 * NO EVIDENCE IS NOT A ZERO. Candidates are passed through in tier-1 order
 * (vector similarity, then the SQL pool), the floor is not applied, topN is,
 * and each finalist is marked `noSkillEvidence` so the log and tier 3 know
 * the score is absence, not judgement. Tier 3 still reads the summaries and
 * scores properly — that is where a skill-less requirement gets its answer.
 *
 * The other branch's alternative — a table of skills guessed from the job
 * title (its `inferRequiredSkills`) — invents evidence. This declines to.
 */
function hasSkillEvidence(requiredSkills) {
  return asSkillList(requiredSkills).map(normalizeSkill).filter(Boolean).length > 0;
}

function rankCandidates({ requiredSkills, candidates, skillFloor, topN }) {
  const evidence = hasSkillEvidence(requiredSkills);
  const scored = candidates.map((c) => ({
    jobId: c.job_id,
    resumeId: c.resume_id,
    candidateId: c.candidate_id,
    skillMatchScore: evidence ? skillMatchScore(requiredSkills, c.skills) : 0,
    noSkillEvidence: !evidence,
  }));

  if (!evidence) {
    // Tier-1 order stands: nothing here can improve on it.
    const finalists = scored.slice(0, topN);
    return {
      finalists,
      gateCut: Math.max(0, scored.length - finalists.length),
      scored,
      noSkillEvidence: true,
    };
  }

  scored.sort((a, b) => b.skillMatchScore - a.skillMatchScore);

  const belowFloor = scored.filter((c) => c.skillMatchScore < skillFloor);
  const aboveFloor = scored.filter((c) => c.skillMatchScore >= skillFloor);
  const finalists = aboveFloor.slice(0, topN);

  return {
    finalists,
    gateCut: belowFloor.length + Math.max(0, aboveFloor.length - finalists.length),
    scored,
    noSkillEvidence: false,
  };
}

/**
 * Mirror: one resume vs many jobs (each job has its own required_skills).
 */
function rankJobsForResume({ resumeSkills, jobs, skillFloor, topN }) {
  // Per job here: each names its own skills, or none. A job with none is
  // not cut by the floor but ranks after every job that earned a score.
  const scored = jobs.map((j) => {
    const evidence = hasSkillEvidence(j.required_skills);
    return {
      jobId: j.job_id,
      resumeId: j.resume_id,
      candidateId: j.candidate_id,
      skillMatchScore: evidence ? skillMatchScore(j.required_skills, resumeSkills) : 0,
      noSkillEvidence: !evidence,
    };
  });

  scored.sort((a, b) => {
    if (a.noSkillEvidence !== b.noSkillEvidence) return a.noSkillEvidence ? 1 : -1;
    return b.skillMatchScore - a.skillMatchScore;
  });

  const belowFloor = scored.filter((c) => !c.noSkillEvidence && c.skillMatchScore < skillFloor);
  const aboveFloor = scored.filter((c) => c.noSkillEvidence || c.skillMatchScore >= skillFloor);
  const finalists = aboveFloor.slice(0, topN);

  return {
    finalists,
    gateCut: belowFloor.length + Math.max(0, aboveFloor.length - finalists.length),
    scored,
    /**
     * Everything that cleared the floor, in score order — `finalists` is just
     * its first `topN`. Returned because the reconcile needs the ones BEYOND
     * topN and already has their scores; recomputing the floor predicate
     * elsewhere is how two copies of a rule drift apart.
     */
    aboveFloor,
  };
}

module.exports = { skillMatchScore, hasSkillEvidence, rankCandidates, rankJobsForResume };
