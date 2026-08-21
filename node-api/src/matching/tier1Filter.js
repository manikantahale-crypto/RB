const matchRepo = require("../repositories/match.repository");
const log = require("../utils/logger");

/**
 * Tier 1 — SQL role filter (0 LLM).
 * TODO: work-auth / location hard filters when structured fields exist on jobs/resumes.
 */
async function filterCandidatesForJob(jobId) {
  const job = await matchRepo.getJobForMatching(jobId);
  if (!job) {
    log.warn(`[tier1] job not found: ${jobId}`);
    return { job: null, pool: [], survivors: [] };
  }
  if (job.processed_at == null) {
    log.warn(`[tier1] job ${jobId} not ready (missing processed_at)`);
    return { job, pool: [], survivors: [] };
  }

  const pool = await matchRepo.findTopCandidatesByVector(jobId);
  return { job, pool, survivors: pool };
}

async function filterJobsForResume(resumeId) {
  const resume = await matchRepo.getResumeForMatching(resumeId);
  if (!resume) {
    log.warn(`[tier1] resume not found: ${resumeId}`);
    return { resume: null, pool: [], survivors: [] };
  }
  if (!resume.is_current || resume.processed_at == null) {
    log.warn(`[tier1] resume ${resumeId} not ready for matching`);
    return { resume, pool: [], survivors: [] };
  }

  const pool = await matchRepo.findTopJobsByVector(resumeId);
  return { resume, pool, survivors: pool };
}

module.exports = { filterCandidatesForJob, filterJobsForResume };
