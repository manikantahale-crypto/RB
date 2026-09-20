const { withTransaction } = require("../../../config/db");
const matchRepo = require("../../../repositories/match.repository");
const { filterCandidatesForJob, filterJobsForResume } = require("./tier1Filter");
const { rankCandidates, rankJobsForResume } = require("./tier2Rank");
const env = require("../../../config/env");
const log = require("../../../utils/logger");
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
      matchId: row.id,
    });

    created.push({ ...f, matchId: row.id });
  }

  return created;
}

/**
 * @param {string} jobId
 * @param {{ matchThreshold?: number, topN?: number }} [options]
 *   Per-run overrides, sent by the orchestrator from a workflow step's
 *   settings. Absent means the deployment defaults below, which is every
 *   caller that is not a workflow.
 *
 *   THESE USED TO BE IGNORED. The orchestrator's node contracts have always
 *   declared `matchThreshold` as an adminExposed setting and sent it in the
 *   request body; this route read `req.params.id` and nothing else. So the
 *   authoring editor rendered a control, somebody set it, and it changed
 *   nothing — with no error anywhere, because the field simply was not read.
 *
 *   `matchThreshold` is the tier-2 skill floor, on the same 0-100 scale
 *   `skillMatchScore` returns.
 */
async function runForJob(jobId, options = {}) {
  const { job, pool, survivors } = await filterCandidatesForJob(jobId);
  if (!job) return { created: [] };

  const skillFloor =
    typeof options.matchThreshold === "number" && Number.isFinite(options.matchThreshold)
      ? options.matchThreshold
      : env.MATCH_SKILL_FLOOR;
  const topN =
    typeof options.topN === "number" && Number.isFinite(options.topN) && options.topN > 0
      ? options.topN
      : env.MATCH_TOP_N;

  const { finalists, gateCut, noSkillEvidence } = rankCandidates({
    requiredSkills: job.required_skills,
    candidates: survivors,
    skillFloor,
    topN,
  });

  log.info(
    `[funnel] job ${jobId}: pool=${pool.length} tier1=${survivors.length} ` +
      `tier2_finalists=${finalists.length} (gate cut ${gateCut}` +
      (noSkillEvidence ? ", NO SKILLS ON THE REQUIREMENT — floor not applied, tier-1 order kept" : "") +
      `, floor=${skillFloor}${skillFloor !== env.MATCH_SKILL_FLOOR ? " from caller" : ""}` +
      `, topN=${topN}${topN !== env.MATCH_TOP_N ? " from caller" : ""})` +
      (pool.length === 0
        ? " — no embedded resumes for this recruiter yet; matching runs again after resume analyze or Save to Library"
        : "")
  );

  const created = await shortlistFinalists(
    finalists.map((f) => ({
      jobId,
      candidateId: f.candidateId,
      resumeId: f.resumeId,
      skillMatchScore: f.skillMatchScore,
    }))
  );

  if (created.length > 0) {
    log.info(
      `[funnel] job ${jobId}: enqueued ${created.length} match pair(s) ` +
        `(orchDelegate=${env.ORCH_DELEGATE_MATCH ? "yes" : "internal worker"})`
    );
  }

  return {
    created,
    poolSize: pool.length,
    tier1: survivors.length,
    finalists: finalists.length,
    gateCut,
  };
}

/**
 * @param {string} resumeId
 * @param {{ matchThreshold?: number, topN?: number }} [options]
 *   Per-run overrides from a workflow step's settings, same as `runForJob`.
 */
async function runForResume(resumeId, options = {}) {
  const { resume, pool, survivors } = await filterJobsForResume(resumeId);
  if (!resume) return { created: [] };

  const skillFloor =
    typeof options.matchThreshold === "number" && Number.isFinite(options.matchThreshold)
      ? options.matchThreshold
      : env.MATCH_SKILL_FLOOR;
  const topN =
    typeof options.topN === "number" && Number.isFinite(options.topN) && options.topN > 0
      ? options.topN
      : env.MATCH_TOP_N;

  const { finalists, gateCut } = rankJobsForResume({
    resumeSkills: resume.skills,
    jobs: survivors,
    skillFloor,
    topN,
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

  // Jobs that finished AI after this resume started may have missed pairing — re-run job funnel.
  const jobIds = [...new Set(survivors.map((s) => s.job_id).filter(Boolean))];
  for (const jid of jobIds) {
    try {
      await runForJob(jid);
    } catch (err) {
      log.warn(`[funnel] resume ${resumeId}: reconcile job ${jid} failed: ${err.message}`);
    }
  }

  return {
    created,
    poolSize: pool.length,
    tier1: survivors.length,
    finalists: finalists.length,
    gateCut,
  };
}

module.exports = { runForJob, runForResume };
