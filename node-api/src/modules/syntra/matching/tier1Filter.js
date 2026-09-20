const matchRepo = require("../../../repositories/match.repository");
const log = require("../../../utils/logger");
const { rolesCompatible } = require("./roleFit");

function jobRoleParts(job) {
  return [job.title, job.primary_role, job.job_title];
}

function resumeRoleParts(row) {
  return [row.current_role, row.current_title, row.resume_primary_role, row.primary_role, row.full_name];
}

/**
 * Tier 1 — vector neighbors, then drop opposite role families (PM vs Finance).
 * Exact SQL role match is unioned in so a Product Manager like Sofia is not
 * dropped just because a re-uploaded JD embedding drifted toward finance.
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

  const vectorPool = await matchRepo.findTopCandidatesByVector(jobId);
  const rolePool = await matchRepo.findCandidatesForJob(jobId);
  const byResume = new Map();
  for (const row of [...rolePool, ...vectorPool]) {
    if (row.resume_id && !byResume.has(row.resume_id)) byResume.set(row.resume_id, row);
  }
  const pool = [...byResume.values()];
  const survivors = pool.filter((row) =>
    rolesCompatible(jobRoleParts(job), resumeRoleParts(row)),
  );

  if (pool.length === 0) {
    const diag = await matchRepo.countMatchPoolDiagnostics(jobId);
    if (diag) {
      log.info(
        `[tier1] job ${jobId}: pool empty — ` +
          `resumes_ready=${diag.resumes_ready} same_owner=${diag.resumes_same_owner} ` +
          `job_owner=${diag.job_owner || "null"}`
      );
    }
  } else if (survivors.length < pool.length) {
    log.info(
      `[tier1] job ${jobId}: dropped ${pool.length - survivors.length} role-incompatible candidate(s) (kept ${survivors.length})`,
    );
  }

  return { job, pool, survivors };
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

  const vectorPool = await matchRepo.findTopJobsByVector(resumeId);
  const rolePool = await matchRepo.findOpenJobsForResume(resumeId);
  const byJob = new Map();
  for (const row of [...rolePool, ...vectorPool]) {
    if (row.job_id && !byJob.has(row.job_id)) byJob.set(row.job_id, row);
  }
  const pool = [...byJob.values()];
  const survivors = pool.filter((row) =>
    rolesCompatible([row.primary_role, row.job_title, row.title], resumeRoleParts({ ...resume, ...row })),
  );

  return { resume, pool, survivors };
}

module.exports = { filterCandidatesForJob, filterJobsForResume };
