const { withTransaction } = require("../../../config/db");
const matchRepo = require("../../../repositories/match.repository");
const jobRepo = require("../../../repositories/job.repository");
const { skillMatchScore } = require("../matching/tier2Rank");
const { enqueueMatchRequest } = require("./matchEnqueue");

const candidateRepo = require("../../../repositories/candidate.repository");

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Direct user-initiated pair: no Tier 1/2 gate. Enqueues match.requested for Tier-3.
 * @returns {{ matchId: string, created: boolean }}
 */
async function createDirectMatch({ jobId, resumeId, userId }) {
  if (!jobId || !resumeId) {
    throw httpError(400, "jobId and resumeId are required");
  }

  const job = await jobRepo.getJobById(jobId, userId);
  if (!job) throw httpError(404, `Job not found: ${jobId}`);

  const resume = await matchRepo.getResumeForMatching(resumeId);
  if (!resume) throw httpError(404, `Resume not found: ${resumeId}`);

  const candidate = await candidateRepo.getCandidateWithCurrentResume(resume.candidate_id, userId);
  if (!candidate) throw httpError(404, `Resume not found: ${resumeId}`);

  const score = skillMatchScore(job.required_skills, resume.skills);

  const created = await withTransaction(async (client) => {
    return matchRepo.insertShortlistRow(client, {
      jobId,
      candidateId: resume.candidate_id,
      resumeId,
      skillMatchScore: score,
    });
  });

  if (created) {
    await enqueueMatchRequest({
      jobId,
      candidateId: resume.candidate_id,
      resumeId,
      skillMatchScore: score,
      matchId: created.id,
    });
    return { matchId: created.id, created: true };
  }

  const existingId = await matchRepo.findMatchIdByJobResume(jobId, resumeId);
  if (!existingId) {
    throw httpError(500, "Match conflict but existing row not found");
  }
  return { matchId: existingId, created: false };
}

module.exports = { createDirectMatch };
