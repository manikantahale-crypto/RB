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
  return String(skill).trim().toLowerCase();
}

function skillMatchScore(requiredSkills, candidateSkills) {
  const required = asSkillList(requiredSkills).map(normalizeSkill).filter(Boolean);
  const candidate = new Set(
    asSkillList(candidateSkills).map(normalizeSkill).filter(Boolean)
  );

  const requiredCount = required.length;
  if (requiredCount === 0) return 0;

  const uniqueRequired = [...new Set(required)];
  const overlapCount = uniqueRequired.filter((s) => candidate.has(s)).length;
  return Math.round((overlapCount / uniqueRequired.length) * 100);
}

/**
 * @param {object} opts
 * @param {string[]} opts.requiredSkills
 * @param {Array<{ resume_id: string, candidate_id: string, skills: any }>} opts.candidates
 * @param {number} opts.skillFloor
 * @param {number} opts.topN
 */
function rankCandidates({ requiredSkills, candidates, skillFloor, topN }) {
  const scored = candidates.map((c) => ({
    jobId: c.job_id,
    resumeId: c.resume_id,
    candidateId: c.candidate_id,
    skillMatchScore: skillMatchScore(requiredSkills, c.skills),
  }));

  scored.sort((a, b) => b.skillMatchScore - a.skillMatchScore);

  const belowFloor = scored.filter((c) => c.skillMatchScore < skillFloor);
  const aboveFloor = scored.filter((c) => c.skillMatchScore >= skillFloor);
  const finalists = aboveFloor.slice(0, topN);

  return {
    finalists,
    gateCut: belowFloor.length + Math.max(0, aboveFloor.length - finalists.length),
    scored,
  };
}

/**
 * Mirror: one resume vs many jobs (each job has its own required_skills).
 */
function rankJobsForResume({ resumeSkills, jobs, skillFloor, topN }) {
  const scored = jobs.map((j) => ({
    jobId: j.job_id,
    resumeId: j.resume_id,
    candidateId: j.candidate_id,
    skillMatchScore: skillMatchScore(j.required_skills, resumeSkills),
  }));

  scored.sort((a, b) => b.skillMatchScore - a.skillMatchScore);

  const belowFloor = scored.filter((c) => c.skillMatchScore < skillFloor);
  const aboveFloor = scored.filter((c) => c.skillMatchScore >= skillFloor);
  const finalists = aboveFloor.slice(0, topN);

  return {
    finalists,
    gateCut: belowFloor.length + Math.max(0, aboveFloor.length - finalists.length),
    scored,
  };
}

module.exports = { skillMatchScore, rankCandidates, rankJobsForResume };
