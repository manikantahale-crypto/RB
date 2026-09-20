const matchRepo = require("../../../repositories/match.repository");
const {
  matchBatchSummariesToSummary,
  matchSummaryToSummary,
  recommendationLabelFromScore,
  nextActionFromScore,
} = require("../ai/matching");
const { toPercentScore } = require("../matching/roleFit");
const { skillEvidence, applyScoreCaps } = require("../matching/scoreCaps");
const log = require("../../../utils/logger");

function hasUsableScore(item) {
  if (!item) return false;
  const n = Number(item.match_score);
  return Number.isFinite(n);
}

function resolveBatchItem(pair, batchResult, index) {
  const results = batchResult.results || [];
  const resultsMap = new Map();
  const byResume = new Map();
  const byCandidate = new Map();
  results.forEach((r) => {
    const cid = String(r.candidate_id || "").trim().toLowerCase();
    const rid = String(r.resume_id || "").trim().toLowerCase();
    if (cid && rid) resultsMap.set(`${cid}:${rid}`, r);
    if (rid) {
      if (!byResume.has(rid)) byResume.set(rid, []);
      byResume.get(rid).push(r);
    }
    if (cid) {
      if (!byCandidate.has(cid)) byCandidate.set(cid, []);
      byCandidate.get(cid).push(r);
    }
  });

  const key = `${String(pair.candidate_id).toLowerCase()}:${String(pair.resume_id).toLowerCase()}`;
  let item = resultsMap.get(key);
  if (!item) {
    const resumeHits = byResume.get(String(pair.resume_id).toLowerCase()) || [];
    if (resumeHits.length === 1) item = resumeHits[0];
  }
  if (!item) {
    const candHits = byCandidate.get(String(pair.candidate_id).toLowerCase()) || [];
    if (candHits.length === 1) item = candHits[0];
  }
  if (!item && results.length === 1 && hasUsableScore(results[0])) {
    item = results[0];
  }
  if (!item && hasUsableScore(results[index]) && results.length === batchResult.pairCount) {
    item = results[index];
  }
  return item;
}

async function persistScore(pair, item) {
  /**
   * The model scored two summaries; the requirement's own skill lists are
   * the evidence it did not see. A candidate missing a mandatory skill, or
   * covering too little of the required list, is capped here and the row
   * says so (scoreCaps.js). `llm_score` keeps what the model said.
   */
  const capped = applyScoreCaps({
    llmScore: toPercentScore(item.match_score),
    evidence: pair.evidence,
  });
  await matchRepo.saveScoreResult(pair.jobId, pair.resume_id, {
    score: capped.score,
    llmScore: capped.llmScore,
    scoreSource: capped.scoreSource,
    tier: item.match_status || "weak",
    reasoning: item.consultant_response || "",
    strengths: item.strengths || [],
    gaps: item.gaps || [],
    greenFlags: item.green_flags || [],
    redFlags: item.red_flags || [],
    confidenceScore: item.confidence_score || 0,
    breakdown: item.breakdown || {},
    evidence: {
      caps_applied: capped.capsApplied,
      caps_advisory: capped.capsAdvisory,
      required_coverage: pair.evidence.requiredCoverage,
      mandatory_coverage: pair.evidence.mandatoryCoverage,
      ranking_explanation: item.ranking_explanation || "",
      recommendation: recommendationLabelFromScore(
        item.match_score,
        item.match_status,
        item.recommendation,
      ),
      next_action: nextActionFromScore(
        item.match_score,
        item.match_status,
        item.next_action,
      ),
    },
  });
}

async function scorePairIndividually(pair) {
  const parsed = await matchSummaryToSummary(pair.resume_summary, pair.jd_summary);
  await persistScore(pair, parsed);
}

async function processBatchForJob(jobId, candidateRows) {
  const outcome = { requested: candidateRows?.length ?? 0, scored: 0, failed: 0, missingSummary: 0 };
  if (!candidateRows || candidateRows.length === 0) return outcome;

  const validPairs = [];
  log.info(`match scoring started job=${jobId} candidates=${candidateRows.length}`);
  const startTime = Date.now();

  for (const c of candidateRows) {
    const row = await matchRepo.getSummariesForScoring(jobId, c.resumeId);
    if (row && row.jd_summary && row.resume_summary) {
      await matchRepo.markMatching(jobId, c.resumeId);
      validPairs.push({
        jobId,
        candidate_id: c.candidateId || row.candidate_id,
        resume_id: c.resumeId,
        jd_summary: row.jd_summary,
        resume_summary: row.resume_summary,
        score_threshold: row.score_threshold != null ? Number(row.score_threshold) : 60,
        evidence: skillEvidence({
          requiredSkills: row.required_skills,
          mandatorySkills: row.mandatory_skills,
          candidateSkills: row.resume_skills,
        }),
      });
    } else {
      await matchRepo.saveCandidateFailure(jobId, c.resumeId, {
        stage: "matching",
        errorCode: "MISSING_SUMMARY",
        errorMessage: `Missing summary data for JD ${jobId} or Resume ${c.resumeId}`,
        retryable: true,
      });
      log.warn(`[WORKER] candidate missing summary data job=${jobId} resume=${c.resumeId}`);
      outcome.missingSummary += 1;
    }
  }

  if (validPairs.length === 0) return outcome;

  const jdSummary = validPairs[0].jd_summary;

  try {
    const llmStart = Date.now();
    const batchResult = await matchBatchSummariesToSummary(validPairs, jdSummary);
    log.info(`match scoring batch completed job=${jobId} duration=${Date.now() - llmStart}ms`);
    batchResult.pairCount = validPairs.length;

    for (let i = 0; i < validPairs.length; i++) {
      const pair = validPairs[i];
      const item = resolveBatchItem(pair, batchResult, i);
      const llmSaidFailed = String(item?.status || "").toLowerCase() === "failed";

      if (hasUsableScore(item) && !llmSaidFailed) {
        await persistScore(pair, item);
        outcome.scored += 1;
        continue;
      }

      try {
        log.warn(
          `[WORKER] batch item missing — scoring individually job=${pair.jobId} candidate=${pair.candidate_id}`,
        );
        await scorePairIndividually(pair);
        outcome.scored += 1;
      } catch (oneErr) {
        outcome.failed += 1;
        await matchRepo.saveCandidateFailure(pair.jobId, pair.resume_id, {
          stage: "matching",
          errorCode: item?.error_code || "BATCH_ITEM_FAILED",
          errorMessage: oneErr.message || item?.error_message || "Candidate match returned failure from LLM batch",
          retryable: true,
        });
        log.warn(`[WORKER] candidate match failed job=${pair.jobId} candidate=${pair.candidate_id} error="${oneErr.message}"`);
      }
    }
    log.info(`match scoring completed job=${jobId} duration=${Date.now() - startTime}ms scored=${outcome.scored} failed=${outcome.failed}`);
  } catch (batchErr) {
    log.error(`[WORKER] match scoring failed job=${jobId} reason="${batchErr.message}" — retrying per candidate`);
    for (const pair of validPairs) {
      try {
        await scorePairIndividually(pair);
        outcome.scored += 1;
      } catch (oneErr) {
        outcome.failed += 1;
        await matchRepo.saveCandidateFailure(pair.jobId, pair.resume_id, {
          stage: "matching",
          errorCode: "BATCH_LLM_ERROR",
          errorMessage: oneErr.message || batchErr.message,
          retryable: true,
        });
      }
    }
  }
  return outcome;
}

async function handleMatchRequested(job) {
  const jobsList = Array.isArray(job) ? job : [job];
  const byJob = new Map();

  for (const j of jobsList) {
    const data = j.data || j;
    const { jobId, resumeId, candidateId } = data || {};
    if (!jobId || !resumeId) continue;
    if (!byJob.has(jobId)) byJob.set(jobId, []);
    byJob.get(jobId).push({ resumeId, candidateId });
  }

  const total = { requested: 0, scored: 0, failed: 0, missingSummary: 0 };
  for (const [jobId, candidates] of byJob.entries()) {
    const o = await processBatchForJob(jobId, candidates);
    for (const k of Object.keys(total)) total[k] += o[k] ?? 0;
  }
  return total;
}

function registerMatchRequestedWorker(boss) {
  return boss.work("match.requested", { teamSize: 1, batchSize: 15 }, async (jobs) => {
    try {
      await handleMatchRequested(jobs);
    } catch (err) {
      log.error(`[WORKER] match.requested worker error reason="${err.message}"`);
    }
  });
}

module.exports = { registerMatchRequestedWorker, handleMatchRequested, processBatchForJob };
