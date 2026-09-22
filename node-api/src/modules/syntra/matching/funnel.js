const { withTransaction } = require("../../../config/db");
const matchRepo = require("../../../repositories/match.repository");
const { filterCandidatesForJob, filterJobsForResume } = require("./tier1Filter");
const { rankCandidates, rankJobsForResume } = require("./tier2Rank");
const env = require("../../../config/env");
const log = require("../../../utils/logger");
const { enqueueMatchRequest } = require("../services/matchEnqueue");

/**
 * The pairs this resume should have that its own top-N did not cover.
 *
 * WHAT THE RECONCILE IS FOR. Pairing is asymmetric. A row for (job J, resume R)
 * appears if R is among J's best candidates OR J is among R's best jobs. A job
 * processed before R existed built its candidate list without R in the pool, so
 * R can only arrive by the second route — R's own top-N. That leaves a real
 * gap: R may be the strongest candidate available for a job that is nowhere
 * near R's own top 15, simply because few people on the bench suit it. Without
 * this, a recruiter asking "who do we have for this requirement?" never sees
 * them.
 *
 * WHAT IT USED TO DO ABOUT IT, TWICE. First it re-ran the FULL funnel for every
 * surviving job — about 1,700 of them, nine seconds each, inline, inside a
 * request that times out at five minutes. Then it published those 1,700 as
 * queue messages instead: no timeout, same number, 4,300 jobs climbing at 190 a
 * minute against a drain of 30.
 *
 * NEITHER WAS NECESSARY. `rankJobsForResume` has already scored this resume
 * against every surviving job — that is how it picked the top 15 — and
 * `aboveFloor` holds all of them in score order. The pairs we want are simply
 * the ones past `topN`. Re-running a job's funnel to rediscover a score
 * computed moments earlier was the whole mistake.
 *
 * So: no queue messages, no funnel re-runs, no fan-out. Just the rows, taken in
 * score order and capped, because "every job that missed this resume" is very
 * nearly "every job there is" — 3,416 requirements have finished extraction and
 * almost all predate any new resume.
 *
 * Conservative on a missing timestamp: without both there is no evidence the
 * job's funnel saw this resume, and missing a pairing is worse than one extra.
 */
function pairsNeedingReconcile(aboveFloor, resume, survivors, topN, limit) {
  const resumeReadyAt = resume?.processed_at
    ? new Date(resume.processed_at).getTime()
    : null;

  /** When each job last ran its own funnel, by job id. */
  const ranAt = new Map();
  for (const row of survivors ?? []) {
    if (row?.job_id && !ranAt.has(row.job_id)) {
      ranAt.set(
        row.job_id,
        row.job_processed_at ? new Date(row.job_processed_at).getTime() : null,
      );
    }
  }

  const out = [];
  const seen = new Set();
  // Past `topN`: everything before it already has a row from the shortlist.
  for (const pair of (aboveFloor ?? []).slice(topN)) {
    if (out.length >= limit) break;
    const jobId = pair?.jobId;
    if (!jobId || seen.has(jobId)) continue;
    seen.add(jobId);

    const jobRanAt = ranAt.has(jobId) ? ranAt.get(jobId) : null;
    const sawThisResume =
      resumeReadyAt !== null && jobRanAt !== null && jobRanAt >= resumeReadyAt;
    if (!sawThisResume) out.push(pair);
  }
  return out;
}

async function shortlistFinalists(finalists, signal) {
  const created = [];

  for (const f of finalists) {
    /**
     * The caller gave up, so stop making work for it.
     *
     * Express does not abort a handler when the client disconnects, and
     * nothing on this path used to look. So when `syntra.bench.alert` hit its
     * five-minute timeout the orchestrator aborted its fetch, retried, and
     * node-api carried on running the ORIGINAL request underneath — each retry
     * stacking another copy rather than replacing one. Six ran at once.
     *
     * Checked between rows rather than mid-insert: what is already committed
     * stays, and `created` reports honestly how far it got.
     */
    if (signal?.aborted) {
      log.warn(
        `[funnel] caller went away after ${created.length} of ${finalists.length} pair(s) — stopping`,
      );
      break;
    }
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
  const { signal } = options;
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
    })),
    signal,
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
  const { signal } = options;
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

  const { finalists, gateCut, aboveFloor } = rankJobsForResume({
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
    })),
    signal,
  );

  /**
   * The same call that made the shortlist, for the pairs it did not cover.
   *
   * `shortlistFinalists` inserts with ON CONFLICT DO NOTHING and enqueues only
   * what it actually created, so a pair that already exists costs nothing and
   * emits nothing.
   *
   * A job's list may now hold more than `topN` candidates. That is fine —
   * `topN` is a selection heuristic at the moment of creation, not an invariant
   * on the table, and every other row arrives the same way.
   */
  const reconciled = await shortlistFinalists(
    pairsNeedingReconcile(
      aboveFloor,
      resume,
      survivors,
      topN,
      env.MATCH_RECONCILE_MAX,
    ).map((p) => ({
      jobId: p.jobId,
      candidateId: p.candidateId,
      resumeId,
      skillMatchScore: p.skillMatchScore,
    })),
    signal,
  );

  if (reconciled.length > 0) {
    log.info(
      `[funnel] resume ${resumeId}: reconciled ${reconciled.length} pair(s) beyond ` +
        `the top ${topN} (cap ${env.MATCH_RECONCILE_MAX})`,
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

module.exports = { runForJob, runForResume, pairsNeedingReconcile };
