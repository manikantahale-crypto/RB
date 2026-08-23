const matchRepo = require("../repositories/match.repository");
const { matchSummaryToSummary, matchBatchSummariesToSummary } = require("../ai/matching");
const log = require("../utils/logger");

async function processBatchForJob(jobId, candidateRows) {
  if (!candidateRows || candidateRows.length === 0) return;

  const validPairs = [];
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
      });
    } else {
      await matchRepo.saveCandidateFailure(jobId, c.resumeId, {
        stage: "matching",
        errorCode: "MISSING_SUMMARY",
        errorMessage: `Missing summary data for JD ${jobId} or Resume ${c.resumeId}`,
        retryable: true,
      });
    }
  }

  if (validPairs.length === 0) return;

  const jdSummary = validPairs[0].jd_summary;

  try {
    log.info(`[match.requested] Sending batch LLM scoring request for job=${jobId} candidateCount=${validPairs.length}`);
    const batchResult = await matchBatchSummariesToSummary(validPairs, jdSummary);
    const resultsMap = new Map();
    (batchResult.results || []).forEach((r) => {
      const key = `${r.candidate_id || ''}:${r.resume_id || ''}`;
      resultsMap.set(key, r);
    });

    for (const pair of validPairs) {
      const key = `${pair.candidate_id}:${pair.resume_id}`;
      const item = resultsMap.get(key);

      if (item && item.status !== "failed") {
        await matchRepo.saveScoreResult(pair.jobId, pair.resume_id, {
          score: item.match_score || 0,
          tier: item.match_status || "weak",
          reasoning: item.consultant_response || "",
          strengths: item.strengths || [],
          gaps: item.gaps || [],
          greenFlags: item.green_flags || [],
          redFlags: item.red_flags || [],
          confidenceScore: item.confidence_score || 0,
          breakdown: item.breakdown || {},
          evidence: [],
        });
        log.info(`[match.requested] Saved score for candidate=${pair.candidate_id} score=${item.match_score}`);
      } else {
        await matchRepo.saveCandidateFailure(pair.jobId, pair.resume_id, {
          stage: "matching",
          errorCode: item?.error_code || "BATCH_ITEM_FAILED",
          errorMessage: item?.error_message || "Candidate match returned failure from LLM batch",
          retryable: true,
        });
        log.warn(`[match.requested] Candidate ${pair.candidate_id} failed in batch; saved failure record (retryable=true)`);
      }
    }
  } catch (batchErr) {
    log.error(`[match.requested] Entire batch LLM call failed for job ${jobId}: ${batchErr.message}`);
    // Isolate failures: mark each candidate in batch with failure record (no rollback of already saved items)
    for (const pair of validPairs) {
      await matchRepo.saveCandidateFailure(pair.jobId, pair.resume_id, {
        stage: "matching",
        errorCode: "BATCH_LLM_ERROR",
        errorMessage: batchErr.message,
        retryable: true,
      });
    }
  }
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

  for (const [jobId, candidates] of byJob.entries()) {
    await processBatchForJob(jobId, candidates);
  }
}

function registerMatchRequestedWorker(boss) {
  return boss.work("match.requested", { teamSize: 1, batchSize: 15 }, async (jobs) => {
    try {
      await handleMatchRequested(jobs);
    } catch (err) {
      log.error(`[match.requested] Worker error: ${err.message}`);
      log.error(err.stack || err);
    }
  });
}

module.exports = { registerMatchRequestedWorker, handleMatchRequested, processBatchForJob };
