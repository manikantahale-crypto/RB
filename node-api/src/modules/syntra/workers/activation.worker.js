/**
 * Re-run the funnel when an entity is activated in bulk.
 *
 * WHY THIS EXISTS AT ALL
 *
 * `job.service.bulkSaveJobs` and `resume.service.bulkSaveCandidates` used to
 * call SYNTRA's funnel directly:
 *
 *     runForJob(jobId).catch((err) => log.error(...));
 *
 * Two things were wrong with that. The obvious one is the boundary: a core
 * entity service importing an application means every other application that
 * ever saves a job inherits a dependency on SYNTRA.
 *
 * The less obvious one is that it was already unreliable. Fire-and-forget with
 * a `.catch()` that only logs means a funnel run that fails is gone — no retry,
 * no record, nothing to look at later beyond a line in a log file nobody reads.
 * Activating two hundred jobs fired two hundred unawaited promises at once.
 *
 * So this is not purity work. Going through the queue makes the same work
 * retryable, batched, and visible in `pgboss.job` — and removes the import as a
 * side effect.
 *
 * The shape was already in the codebase: `createJob` publishes `jd.uploaded`
 * rather than calling anything, and `retryCandidateMatch` re-enqueues on
 * `match.requested`. A queue name is a message; it is not a dependency.
 *
 * The events are facts, not commands. The entity service says a job was
 * activated; what SYNTRA chooses to do about that is SYNTRA's business, and a
 * second application could answer the same fact later without either side
 * changing.
 */
const log = require("../../../utils/logger");

/** `job.activated` — { jobId } */
async function handleJobActivated(jobs) {
  const list = Array.isArray(jobs) ? jobs : [jobs];
  const { runForJob } = require("../matching/funnel");

  for (const j of list) {
    const { jobId } = j.data || j || {};
    if (!jobId) continue;
    // Deliberately awaited and NOT swallowed. A throw here fails the pg-boss
    // job, which retries it — the behaviour the old `.catch(log)` gave up.
    await runForJob(jobId);
    log.info(`[job.activated] funnel complete job=${jobId}`);
  }
}

/** `candidate.activated` — { candidateId, userId } */
async function handleCandidateActivated(jobs) {
  const list = Array.isArray(jobs) ? jobs : [jobs];
  const { runForResume } = require("../matching/funnel");
  const candidateRepo = require("../../../repositories/candidate.repository");

  for (const j of list) {
    const { candidateId, userId } = j.data || j || {};
    if (!candidateId) continue;

    const resumeId = await candidateRepo.getCurrentResumeId(candidateId, userId);
    if (!resumeId) {
      // Not a failure: a candidate can be activated before a resume is current.
      log.info(`[candidate.activated] no current resume candidate=${candidateId}`);
      continue;
    }
    await runForResume(resumeId);
    log.info(`[candidate.activated] funnel complete candidate=${candidateId}`);
  }
}

function registerActivationWorkers(boss) {
  return Promise.all([
    boss.work("job.activated", { teamSize: 1, batchSize: 5 }, handleJobActivated),
    boss.work(
      "candidate.activated",
      { teamSize: 1, batchSize: 5 },
      handleCandidateActivated,
    ),
  ]);
}

module.exports = {
  registerActivationWorkers,
  handleJobActivated,
  handleCandidateActivated,
};
