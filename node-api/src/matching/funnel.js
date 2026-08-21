const { withTransaction } = require("../config/db");
const matchRepo = require("../repositories/match.repository");
const { filterCandidatesForJob, filterJobsForResume } = require("./tier1Filter");
const { rankCandidates, rankJobsForResume } = require("./tier2Rank");
const env = require("../config/env");
const log = require("../utils/logger");
const { enqueueMatchRequest } = require("../services/matchEnqueue");

async function shortlistFinalists(finalists) {
  const created = [];

  for (const f of finalists) {
    const row = await withTransaction(async (client) => {
      return matchRepo.insertShortlistRow(client, {
        jobId: f.jobId,
        candidateId: f.candidateId,
        resumeId: f.resumeId,
        skillMatchScore: f.skillMatchScore,
      });
    });

    // Already exists (requested/completed) — do not enqueue again
    if (!row) continue;

    await enqueueMatchRequest({
      jobId: f.jobId,
      candidateId: f.candidateId,
      resumeId: f.resumeId,
      skillMatchScore: f.skillMatchScore,
    });

    created.push({ ...f, matchId: row.id });
  }

  return created;
}

async function runForJob(jobId) {
  const { job, pool, survivors } = await filterCandidatesForJob(jobId);
  if (!job) return { created: [] };

  const { finalists, gateCut } = rankCandidates({
    requiredSkills: job.required_skills,
    candidates: survivors,
    skillFloor: env.MATCH_SKILL_FLOOR,
    topN: env.MATCH_TOP_N,
  });

  log.info(
    `[funnel] job ${jobId}: pool=${pool.length} tier1=${survivors.length} ` +
      `tier2_finalists=${finalists.length} (gate cut ${gateCut})`
  );

  const created = await shortlistFinalists(
    finalists.map((f) => ({
      jobId,
      candidateId: f.candidateId,
      resumeId: f.resumeId,
      skillMatchScore: f.skillMatchScore,
    }))
  );

  return {
    created,
    poolSize: pool.length,
    tier1: survivors.length,
    finalists: finalists.length,
    gateCut,
  };
}

async function runForResume(resumeId) {
  const { resume, pool, survivors } = await filterJobsForResume(resumeId);
  if (!resume) return { created: [] };

  const { finalists, gateCut } = rankJobsForResume({
    resumeSkills: resume.skills,
    jobs: survivors,
    skillFloor: env.MATCH_SKILL_FLOOR,
    topN: env.MATCH_TOP_N,
  });

  log.info(
    `[funnel] resume ${resumeId}: pool=${pool.length} tier1=${survivors.length} ` +
      `tier2_finalists=${finalists.length} (gate cut ${gateCut})`
  );

  const created = await shortlistFinalists(
    finalists.map((f) => ({
      jobId: f.jobId,
      candidateId: f.candidateId,
      resumeId,
      skillMatchScore: f.skillMatchScore,
    }))
  );

  return {
    created,
    poolSize: pool.length,
    tier1: survivors.length,
    finalists: finalists.length,
    gateCut,
  };
}

module.exports = { runForJob, runForResume };
