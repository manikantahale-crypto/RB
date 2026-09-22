const express = require("express");
const crypto = require("crypto");
const { pool } = require("../../../config/db");
const { handleJdUploaded } = require("../workers/jdUploaded.worker");
const { handleResumeUploaded } = require("../workers/resumeUploaded.worker");
const { handleMatchRequested } = require("../workers/matchRequested.worker");
const { runForJob } = require("../matching/funnel");
const env = require("../../../config/env");
const reviewService = require("../services/recruiterReview.service");
const platformEvents = require("../../../services/platformEvents.service");
const log = require("../../../utils/logger");
const internalOrch = require("../services/internalOrchestration.service");
const jobRepo = require("../../../repositories/job.repository");
const matchRepo = require("../../../repositories/match.repository");
const activityRepo = require("../../../repositories/activity.repository");
const { buildShortlistCandidates, isPlaceholderEmail } = require("../utils/shortlistCandidates");
const { internalHeaders } = require("../../../utils/internalHeaders");

const router = express.Router();

// JD processing — summarize + funnel
router.post("/internal/jobs/:id/process", async (req, res) => {
  const jobId = req.params.id;
  try {
    /**
     * The orchestrator sends the step's settings here. Only the ones this
     * service honours are picked out — see the note on continuous-match.
     */
    await handleJdUploaded({ data: { jobId } }, { maxAttempts: req.body?.maxAttempts });
    res.json({ status: "processed", jobId });
  } catch (err) {
    log.error(`[internal] job ${jobId} failed: ${err.message}`);
    res.status(500).json({ status: "failed", jobId, error: err.message });
  }
});

/** Orchestrator syntra.continuous.match — tier-1/2 funnel + platform match events. */
router.post("/internal/jobs/:id/continuous-match", async (req, res) => {
  const jobId = req.params.id;
  try {
    /**
     * The orchestrator sends a workflow step's settings in the body, and this
     * route used to read only `req.params.id`. So the authoring editor showed
     * a "Match threshold" control, somebody set it, and nothing changed —
     * silently, because the field was never read.
     *
     * Only what this endpoint actually honours is picked out. Forwarding the
     * whole body would let a new setting look supported the day it is declared
     * rather than the day it is wired, which is the fault being fixed.
     */
    const options = {
      matchThreshold: req.body?.matchThreshold,
      topN: req.body?.topN,
    };
    const result = await runForJob(jobId, options);
    const created = result.created ?? [];
    res.json({
      status: "ok",
      jobId,
      result_count: created.length,
      match_job_id: created[0]?.matchId ?? null,
      top_score: created[0]?.skillMatchScore ?? null,
      poolSize: result.poolSize ?? 0,
      finalists: result.finalists ?? 0,
    });
  } catch (err) {
    log.error(`[internal] continuous-match job ${jobId} failed: ${err.message}`);
    res.status(500).json({ status: "failed", jobId, error: err.message });
  }
});

// Resume processing — summarize + candidate profile + funnel
router.post("/internal/resumes/:id/process", async (req, res) => {
  const resumeId = req.params.id;
  const { candidateId } = req.body || {};
  try {
    await handleResumeUploaded(
      { data: { resumeId, candidateId } },
      { matchThreshold: req.body?.matchThreshold, topN: req.body?.topN },
    );
    res.json({ status: "processed", resumeId });
  } catch (err) {
    log.error(`[internal] resume ${resumeId} failed: ${err.message}`);
    res.status(500).json({ status: "failed", resumeId, error: err.message });
  }
});

// Match scoring — needs BOTH jobId and resumeId
router.post("/internal/matches/process", async (req, res) => {
  const { jobId, resumeId } = req.body || {};
  if (!jobId || !resumeId) {
    return res.status(400).json({ status: "failed", error: "jobId and resumeId required" });
  }
  try {
    /**
     * "processed" used to mean only "the request was handled": with no
     * shortlist row for the pair, nothing was scored and the answer was
     * still processed — the August branch report's finding 2.6, "a green
     * node here is not evidence a match happened". The worker now says
     * what it scored, and so does this.
     */
    const outcome = await handleMatchRequested({ data: { jobId, resumeId } });
    const status = outcome.scored > 0 ? "processed" : "not_scored";
    res.status(outcome.scored > 0 || outcome.failed === 0 ? 200 : 502).json({
      status,
      jobId,
      resumeId,
      scored: outcome.scored,
      failed: outcome.failed,
      missing_summary: outcome.missingSummary,
    });
  } catch (err) {
    log.error(`[internal] match ${jobId}/${resumeId} failed: ${err.message}`);
    res.status(500).json({ status: "failed", jobId, resumeId, error: err.message });
  }
});

/** Orchestrator syntra.duplicate.detect — find probable duplicates for a candidate. */
router.post("/internal/candidates/:id/duplicates/detect", async (req, res) => {
  const candidateId = req.params.id;
  try {
    const { rows: baseRows } = await pool.query(
      `SELECT c.id, c.full_name, c.email, c.created_by::text AS created_by
         FROM core.people c
        WHERE c.id = $1`,
      [candidateId],
    );
    const base = baseRows[0];
    if (!base) {
      return res.status(404).json({ status: "not_found", candidateId });
    }

    const namePart = (base.full_name || "").trim().split(/\s+/)[0];
    const { rows: matches } = await pool.query(
      `SELECT c.id, c.full_name, c.email
         FROM core.people c
        WHERE c.id <> $1
          AND c.created_by IS NOT DISTINCT FROM $2
          AND (
            lower(c.email) = lower($3)
            OR ($4 <> '' AND c.full_name ILIKE '%' || $4 || '%')
          )
        ORDER BY c.created_at DESC
        LIMIT 1`,
      [candidateId, base.created_by, base.email || "", namePart],
    );

    const other = matches[0];
    if (!other) {
      log.info(`[internal] duplicate detect candidate=${candidateId}: none`);
      return res.json({ status: "ok", candidateId, duplicate: false });
    }

    const duplicateReviewId = crypto.randomUUID();
    const signals = {
      email_match: Boolean(
        base.email && other.email &&
        base.email.toLowerCase() === other.email.toLowerCase(),
      ),
      name_similarity: true,
    };

    await reviewService.createDuplicateReview({
      userId: base.created_by,
      organizationId: env.ORCH_ORGANIZATION_ID,
      candidateA: candidateId,
      candidateB: other.id,
      signals,
      duplicateReviewId,
    });

    await platformEvents.publishDuplicateReviewRequired({
      duplicateReviewId,
      candidateA: candidateId,
      candidateB: other.id,
      signals,
    });

    log.info(
      `[internal] duplicate detect candidate=${candidateId} → review vs ${other.id}`,
    );
    res.json({
      status: "review_required",
      candidateId,
      candidate_b: other.id,
      duplicateCandidateId: other.id,
      duplicate_review_id: duplicateReviewId,
      signals,
    });
  } catch (err) {
    log.error(`[internal] duplicate detect ${candidateId} failed: ${err.message}`);
    res.status(500).json({ status: "failed", candidateId, error: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────
// The endpoints the other SYNTRA contract nodes call back into. Ported from
// the old project's routes/internal.routes.js on 2026-09-18 — they were
// missing here while adapters/syntra/nodes/{bench-alert,duplicate-merge,
// run-retry,shortlist-notify} already called them (ref/SYNTRA_Onboarding.md
// stage 4). RELAY is reached by URL (RELAY_API_URL, default :3005).
// ─────────────────────────────────────────────────────────────────────────

function relayBaseUrl() {
  return (
    process.env.RELAY_INTERNAL_URL ||
    process.env.RELAY_SERVICE_URL ||
    process.env.RELAY_API_URL ||
    "http://127.0.0.1:3005"
  ).replace(/\/$/, "");
}

/** The CONSENT_BATCH_SENT activity the old pipeline.service wrote — one entry, on the first candidate. */
async function noteConsentBatch({ jobId, job, sentCount, candidates, correlationId, errors }) {
  if (!jobId || !job?.created_by || sentCount <= 0) return null;
  const anchorId = candidates[0]?.id || candidates[0]?.candidate_id;
  if (!anchorId) return null;
  if (!(await matchRepo.candidateBelongsToJobOwner(anchorId, jobId))) return null;
  const title = job.title || job.primary_role || "Opportunity";
  return activityRepo.createActivity({
    candidateId: anchorId,
    activityType: "CONSENT_BATCH_SENT",
    actorType: "SYSTEM",
    summary: `${sentCount} consent email(s) sent to ${sentCount === 1 ? "1 candidate" : `${sentCount} candidates`} for "${title}"`,
    payload: {
      job_id: jobId,
      job_title: title,
      sent_count: sentCount,
      candidate_names: candidates.map((c) => c.name || c.email).filter(Boolean).slice(0, 8),
      candidates: candidates.map((c) => ({ id: c.id || c.candidate_id, name: c.name, email: c.email })),
      correlation_id: correlationId || null,
      send_errors: errors || [],
    },
  });
}

/** syntra.shortlist.notify — top matches → consent emails via RELAY. */
router.post("/internal/jobs/:jobId/shortlist/notify", async (req, res) => {
  const jobId = req.params.jobId;
  const body = req.body || {};
  try {
    const job = await jobRepo.getJobById(jobId);
    const defaultThreshold = job?.score_threshold != null ? Number(job.score_threshold) : 50;
    const requestedMin = Number(body.min_score ?? body.minScore ?? defaultThreshold) || 0;
    const consentFloor = Math.max(
      parseInt(process.env.VENDOR_JD_CONSENT_MIN_SCORE || String(defaultThreshold), 10) || defaultThreshold,
      defaultThreshold,
      1,
    );
    const minScore = Math.max(requestedMin, consentFloor);
    const limit = Math.min(Number(body.limit ?? 5) || 5, 10);
    const force = Boolean(body.force);
    const top_candidates = await buildShortlistCandidates(jobId, { minScore, limit });
    const top = top_candidates;

    log.info(`[internal] shortlist notify job=${jobId} top=${top_candidates.length} minScore=${minScore} result_count=${body.result_count ?? top.length}`);

    const realEmailCandidates = top_candidates.filter((c) => !isPlaceholderEmail(c.email));
    if (realEmailCandidates.length === 0 && top_candidates.length > 0) {
      log.warn(`[internal] shortlist job=${jobId}: ${top_candidates.length} match(es) but all have placeholder emails — update candidate email in Resumes`);
    }

    if (top_candidates.length === 0) {
      return res.json({
        status: "no_candidates", jobId, requirement_id: jobId, min_score: minScore,
        top_candidates: [], candidate_ids: [], consent_sent: 0, consent_dispatched: false, awaiting_approval: false,
        message: "No eligible matches with email above threshold — consent not sent",
      });
    }

    const candidatesForConsent = realEmailCandidates.length ? realEmailCandidates : top_candidates;
    const relayThreadId = body.relay_thread_id ?? body.vendor_thread_id ?? job?.relay_thread_id ?? null;
    const relayBase = relayBaseUrl();

    if (relayThreadId && top_candidates.length) {
      try {
        await fetch(`${relayBase}/internal/shortlist/pending`, {
          method: "POST", headers: internalHeaders(),
          body: JSON.stringify({
            jobId, requirement_id: jobId, relay_thread_id: relayThreadId,
            vendor_email: body.vendor_email ?? job?.source_email,
            match_job_id: body.match_job_id ?? top[0]?.match_id ?? null,
            result_count: body.result_count ?? top.length,
            top_candidates: candidatesForConsent,
          }),
        });
      } catch (err) {
        log.warn(`[internal] relay shortlist pending failed job=${jobId}: ${err.message}`);
      }
    }

    let consentSent = 0;
    let consentData = null;
    if (candidatesForConsent.length) {
      try {
        const consentRes = await fetch(`${relayBase}/internal/consent/send`, {
          method: "POST", headers: internalHeaders(),
          body: JSON.stringify({
            jobId, requirement_id: jobId, correlation_id: body.correlation_id,
            top_candidates: candidatesForConsent, vendor_thread_id: relayThreadId,
            vendor_email: body.vendor_email ?? job?.source_email, force,
          }),
        });
        if (consentRes.ok) {
          consentData = await consentRes.json();
          consentSent = consentData.sent_count ?? 0;
          log.info(`[internal] auto consent job=${jobId} sent=${consentSent}`);
          if (consentData.send_errors?.length) {
            log.warn(`[internal] auto consent job=${jobId} send_errors: ${JSON.stringify(consentData.send_errors)}`);
          }
          if (consentSent > 0) {
            try {
              await noteConsentBatch({
                jobId, job, sentCount: consentSent,
                candidates: (consentData.consent_threads || []).map((t) => ({
                  id: t.candidate_id, name: top_candidates.find((c) => c.id === t.candidate_id)?.name, email: t.email,
                })),
                correlationId: consentData.correlation_id, errors: consentData.send_errors || [],
              });
            } catch (batchErr) {
              log.warn(`[internal] consent batch activity job=${jobId}: ${batchErr.message}`);
            }
          }
          if (relayThreadId && consentSent > 0) {
            try {
              await fetch(`${relayBase}/internal/shortlist/approved`, {
                method: "POST", headers: internalHeaders(),
                body: JSON.stringify({ jobId, relay_thread_id: relayThreadId, top_candidates, consent: consentData }),
              });
            } catch (err) {
              log.warn(`[internal] relay shortlist approved update failed job=${jobId}: ${err.message}`);
            }
          }
        } else {
          const text = await consentRes.text().catch(() => "");
          log.warn(`[internal] auto consent failed job=${jobId}: ${consentRes.status} ${text.slice(0, 120)}`);
        }
      } catch (err) {
        log.warn(`[internal] auto consent unreachable job=${jobId}: ${err.message}`);
      }
    }

    res.json({
      status: "ok", jobId, requirement_id: jobId, relay_thread_id: relayThreadId,
      match_job_id: body.match_job_id ?? top[0]?.match_id ?? null,
      result_count: body.result_count ?? top.length, min_score: minScore,
      top_score: top[0]?.effective_score ?? top[0]?.score ?? top[0]?.skill_match_score ?? null,
      top_candidates, candidate_ids: top_candidates.map((c) => c.id),
      consent_sent: consentSent, consent_dispatched: consentSent > 0,
      consent_errors: consentData?.send_errors ?? [], awaiting_approval: false,
    });
  } catch (err) {
    log.error(`[internal] shortlist notify job ${jobId} failed: ${err.message}`);
    res.status(500).json({ status: "failed", jobId, error: err.message });
  }
});

/** Recruiter approved a shortlist — consent emails via RELAY. */
router.post("/internal/jobs/:jobId/shortlist/approve", async (req, res) => {
  const jobId = req.params.jobId;
  const body = req.body || {};
  try {
    const minScore = Number(body.min_score ?? body.minScore ?? 0) || 0;
    const limit = Math.min(Number(body.limit ?? 5) || 5, 10);
    const rows = await matchRepo.listMatchesForJob(jobId, { minScore });
    const top = rows.slice(0, limit);
    const job = await jobRepo.getJobById(jobId);
    if (!top.length) {
      return res.status(400).json({ status: "failed", jobId, error: "No matches to approve" });
    }
    const top_candidates = top.map((row) => ({
      id: row.candidate_id, email: row.email, name: row.full_name, resume_id: row.resume_id,
      score: row.score ?? row.skill_match_score,
    }));
    const relayThreadId = body.relay_thread_id ?? body.vendor_thread_id ?? job?.relay_thread_id ?? null;
    const relayBase = relayBaseUrl();
    const consentRes = await fetch(`${relayBase}/internal/consent/send`, {
      method: "POST", headers: internalHeaders(),
      body: JSON.stringify({
        jobId, requirement_id: jobId, correlation_id: body.correlation_id, top_candidates,
        vendor_thread_id: relayThreadId, vendor_email: body.vendor_email ?? job?.source_email,
      }),
    });
    if (!consentRes.ok) {
      const text = await consentRes.text().catch(() => "");
      return res.status(502).json({ status: "failed", jobId, error: `Consent send failed: ${consentRes.status} ${text.slice(0, 200)}` });
    }
    const consentData = await consentRes.json();
    if (relayThreadId) {
      try {
        await fetch(`${relayBase}/internal/shortlist/approved`, {
          method: "POST", headers: internalHeaders(),
          body: JSON.stringify({ jobId, relay_thread_id: relayThreadId, top_candidates, consent: consentData }),
        });
      } catch (err) {
        log.warn(`[internal] relay shortlist approved update failed job=${jobId}: ${err.message}`);
      }
    }
    log.info(`[internal] shortlist approved job=${jobId} consent_sent=${consentData.sent_count ?? 0}`);
    res.json({ status: "approved", jobId, relay_thread_id: relayThreadId, sent_count: consentData.sent_count ?? 0, top_candidates, consent: consentData });
  } catch (err) {
    log.error(`[internal] shortlist approve job ${jobId} failed: ${err.message}`);
    res.status(500).json({ status: "failed", jobId, error: err.message });
  }
});

/** syntra.bench.alert — rank open requirements for a person's current resume. */
router.post("/internal/candidates/:id/bench-alert", async (req, res) => {
  const candidateId = req.params.id;
  try {
    res.json(await internalOrch.benchAlert(candidateId, req.body || {}));
  } catch (err) {
    const status = err.statusCode === 404 ? 404 : 500;
    log.error(`[internal] bench-alert ${candidateId} failed: ${err.message}`);
    res.status(status).json({ status: status === 404 ? "not_found" : "failed", candidateId, error: err.message });
  }
});

/** syntra.duplicate.merge — apply the human merge/keep decision. */
router.post("/internal/approvals/:approvalId/duplicate-merge", async (req, res) => {
  const approvalId = req.params.approvalId;
  try {
    res.json(await internalOrch.duplicateMerge(approvalId, req.body || {}));
  } catch (err) {
    log.error(`[internal] duplicate-merge ${approvalId} failed: ${err.message}`);
    res.status(500).json({ status: "failed", approval_id: approvalId, error: err.message });
  }
});

/** syntra.run.retry — re-emit a failed run's trigger event. */
router.post("/internal/agent-runs/:agentRunId/retry", async (req, res) => {
  const agentRunId = req.params.agentRunId;
  try {
    res.json(await internalOrch.agentRunRetry(agentRunId, req.body || {}));
  } catch (err) {
    const status = err.statusCode === 404 ? 404 : 500;
    log.error(`[internal] run retry ${agentRunId} failed: ${err.message}`);
    res.status(status).json({ status: status === 404 ? "not_found" : "failed", agent_run_id: agentRunId, error: err.message });
  }
});

module.exports = router;
