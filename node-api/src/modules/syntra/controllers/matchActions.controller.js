/**
 * SYNTRA's write endpoints on matches — the ones that RUN matching.
 *
 * Split out of `controllers/matches.controller.js`, which was doing two
 * unrelated jobs: reading `matches` (a core entity that ORBIT submits from and
 * PRISM approves against) and running SYNTRA's Tier-1/2 funnel.
 *
 * The reading half stays in core. This half is SYNTRA's, because the funnel is
 * SYNTRA's — the design is explicit that when the entities move out, what is
 * left of SYNTRA is its matching behaviour.
 *
 * Splitting was the alternative to a permanent exception. Kept whole, the
 * controller had to import `modules/syntra/matching/funnel` from a core file,
 * which is the coupling the shared-core model exists to remove: every other
 * application would inherit a dependency on SYNTRA just by reading a match.
 *
 * `retryCandidateMatch` deliberately did NOT move. It re-enqueues on the
 * `match.requested` queue and imports nothing of SYNTRA's — a queue name is a
 * message, not a dependency. That is exactly the shape the two remaining
 * violations in `job.service` and `resume.service` should take.
 */
const jobRepo = require("../../../repositories/job.repository");
const candidateRepo = require("../../../repositories/candidate.repository");
const matchRepo = require("../../../repositories/match.repository");

function notFound(message) {
  const err = new Error(message);
  err.statusCode = 404;
  return err;
}

async function createDirectMatch(req, res, next) {
  try {
    const matchService = require("../services/match.service");
    const { jobId, resumeId } = req.body || {};
    const result = await matchService.createDirectMatch({
      jobId,
      resumeId,
      userId: req.userId,
    });
    res.status(result.created ? 201 : 200).json(result);
  } catch (err) {
    next(err);
  }
}

/** Run Tier-1/2 funnel for a JD → shortlist candidates → emit match.requested for Tier-3. */
async function runJobMatch(req, res, next) {
  try {
    const { runForJob } = require("../matching/funnel");
    const jobId = req.params.jobId;
    const job = await jobRepo.getJobById(jobId, req.userId);
    if (!job) throw notFound(`Job not found: ${jobId}`);
    if (!job.processed_at) {
      const err = new Error("Job is still processing — wait for AI parsing to finish");
      err.statusCode = 409;
      throw err;
    }
    const result = await runForJob(jobId);
    res.status(202).json({
      jobId,
      created: (result.created || []).length,
      poolSize: result.poolSize || 0,
      finalists: result.finalists || 0,
      matchIds: (result.created || []).map((m) => m.matchId),
    });
  } catch (err) {
    next(err);
  }
}

/** Run Tier-1/2 funnel for a resume → shortlist jobs → emit match.requested for Tier-3. */
async function runResumeMatch(req, res, next) {
  try {
    const { runForResume } = require("../matching/funnel");
    const resumeId = req.params.resumeId;
    const resume = await matchRepo.getResumeForMatching(resumeId);
    if (!resume) throw notFound(`Resume not found: ${resumeId}`);

    // Verify candidate ownership
    const candidate = await candidateRepo.getCandidateWithCurrentResume(
      resume.candidate_id,
      req.userId
    );
    if (!candidate) throw notFound(`Resume not found: ${resumeId}`);

    if (!resume.processed_at) {
      const err = new Error("Resume is still processing — wait for AI parsing to finish");
      err.statusCode = 409;
      throw err;
    }
    const result = await runForResume(resumeId);
    res.status(202).json({
      resumeId,
      candidateId: resume.candidate_id,
      created: (result.created || []).length,
      poolSize: result.poolSize || 0,
      finalists: result.finalists || 0,
      matchIds: (result.created || []).map((m) => m.matchId),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createDirectMatch,
  runJobMatch,
  runResumeMatch,
};
