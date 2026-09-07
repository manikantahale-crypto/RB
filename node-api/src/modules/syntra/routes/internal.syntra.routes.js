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

const router = express.Router();

// JD processing — summarize + funnel
router.post("/internal/jobs/:id/process", async (req, res) => {
  const jobId = req.params.id;
  try {
    await handleJdUploaded({ data: { jobId } });
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
    const result = await runForJob(jobId);
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
    await handleResumeUploaded({ data: { resumeId, candidateId } });
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
    await handleMatchRequested({ data: { jobId, resumeId } });
    res.json({ status: "processed", jobId, resumeId });
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
         FROM syntra.candidates c
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
         FROM syntra.candidates c
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

module.exports = router;
