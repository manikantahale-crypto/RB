/**
 * RELAY → PRISM callbacks. Unauthenticated, internal: RELAY has parsed an
 * inbound email and tells PRISM what it said.
 *
 * Ported from the old project's routes/internal.routes.js lines 736–1363 on
 * 2026-09-18 (ref/PRISM_Onboarding.md stage 4). The four handlers and their
 * correlation rules are as they were, with two changes:
 *
 *   public.prism_submissions → prism.submissions, read through the same
 *   alias the repository uses (person_id AS candidate_id, requirement_id AS
 *   job_id), so the correlation logic is untouched.
 *
 *   The vendor-response handler matched the sender against
 *   `job_descriptions.vendor_email` — a legacy table with its own ids, last
 *   written 2026-08-12, absent from this project. A vendor's email is on
 *   core.vendors, reached through core.requirements.vendor_id; that is the
 *   join here. This is the path as it was meant to work, not as it did.
 *
 * Not ported: /internal/pipeline/consent-sent, /internal/pipeline/consent-decided
 * and /internal/jobs/:jobId/pipeline/match-consent. They are the
 * ASTRA → match → consent chain (vendorJdPipeline.service.js), which reaches
 * into SYNTRA's funnel and ASTRA's worker — decision D6 in ref/Migration_Plan.md.
 */
const express = require("express");
const { pool } = require("../../../config/db");
const log = require("../../../utils/logger");
const prismWorkflow = require("../services/prism.workflow.service");

const router = express.Router();

const SUB = `s.*, s.person_id AS candidate_id, s.requirement_id AS job_id`;

const AWAITING_CONSENT = `
  (
    s.status = 'PENDING_CONSENT'
    OR (
      s.status = 'DRAFT'
      AND EXISTS (
        SELECT 1 FROM prism.consents cons
        WHERE cons.submission_id = s.id AND cons.status = 'REQUESTED'
      )
    )
  )
`;

const YES = ["YES", "APPROVED", "ACCEPTED"];

function fail(res, err, prefix) {
  log.error(`${prefix}: ${err.message}`);
  res.status(err.statusCode || 500).json({
    status: "failed",
    error: err.message,
    code: err.code || null,
    details: err.details || null,
  });
}

/**
 * Candidate consent reply.
 */
router.post("/internal/prism/consent/response", async (req, res) => {
  const { submissionId, candidateId, jobId, senderEmail, response, notes, messageId, threadId } = req.body || {};

  log.info(`[PRISM-RELAY] Inbound consent response received:`, { submissionId, candidateId, jobId, senderEmail, response, messageId, threadId });

  if (!response || !["ACCEPTED", "REJECTED", "APPROVED", "DECLINED", "NO", "YES"].includes(String(response).toUpperCase())) {
    return res.status(400).json({ status: "failed", error: "Valid response ('ACCEPTED' or 'REJECTED') is required." });
  }
  const normalizedResponse = YES.includes(String(response).toUpperCase()) ? "ACCEPTED" : "REJECTED";

  try {
    let targetSubmission = null;

    // 1. Direct submission ID — only if it belongs to the same candidate
    if (submissionId) {
      const { rows } = await pool.query(`SELECT ${SUB} FROM prism.submissions s WHERE s.id = $1`, [submissionId]);
      targetSubmission = rows[0] || null;
      if (targetSubmission && candidateId && targetSubmission.candidate_id !== candidateId) {
        log.warn(`[PRISM-RELAY] submission ${submissionId} belongs to candidate ${targetSubmission.candidate_id}, not ${candidateId} — refusing cross-candidate apply`);
        return res.status(403).json({ status: "failed", error: "Consent reply does not belong to this candidate." });
      }
    }

    // 2. Same candidate + same job only
    if (!targetSubmission && candidateId && jobId) {
      const { rows } = await pool.query(
        `SELECT ${SUB} FROM prism.submissions s
         WHERE s.person_id = $1
           AND (s.requirement_id = $2 OR s.requirement_id::text LIKE $3)
           AND ${AWAITING_CONSENT}
         ORDER BY CASE WHEN s.status = 'PENDING_CONSENT' THEN 0 ELSE 1 END, s.created_at DESC
         LIMIT 2`,
        [candidateId, jobId, `${String(jobId).slice(0, 8)}%`],
      );
      if (rows.length > 1 && rows[0].candidate_id !== rows[1].candidate_id) {
        return res.status(200).json({ status: "ambiguous_or_not_found", message: "Matched more than one candidate for this consent reply." });
      }
      targetSubmission = rows[0] || null;
    }

    // 3. Sender email + job — only if that email maps to exactly one candidate
    if (!targetSubmission && senderEmail && jobId) {
      const { rows } = await pool.query(
        `SELECT ${SUB} FROM prism.submissions s
         JOIN core.people c ON c.id = s.person_id
         WHERE LOWER(TRIM(c.email::text)) = LOWER(TRIM($1))
           AND (s.requirement_id = $2 OR s.requirement_id::text LIKE $3)
           AND ${AWAITING_CONSENT}
         ORDER BY CASE WHEN s.status = 'PENDING_CONSENT' THEN 0 ELSE 1 END, s.created_at DESC`,
        [senderEmail, jobId, `${String(jobId).slice(0, 8)}%`],
      );
      const candidateIds = [...new Set(rows.map((r) => r.candidate_id))];
      if (candidateIds.length > 1) {
        log.warn(`[PRISM-RELAY] Email ${senderEmail} matches ${candidateIds.length} candidates for job ${jobId} — not auto-applying`);
        return res.status(200).json({ status: "ambiguous_or_not_found", message: "This email is used by more than one candidate. Consent was not auto-applied." });
      }
      if (candidateId && rows[0] && rows[0].candidate_id !== candidateId) {
        return res.status(403).json({ status: "failed", error: "Consent reply does not belong to this candidate." });
      }
      targetSubmission = rows[0] || null;
    }

    // 4. Candidate ID only when they have exactly one waiting submission
    if (!targetSubmission && candidateId) {
      const { rows } = await pool.query(
        `SELECT ${SUB} FROM prism.submissions s
         WHERE s.person_id = $1 AND ${AWAITING_CONSENT}
         ORDER BY CASE WHEN s.status = 'PENDING_CONSENT' THEN 0 ELSE 1 END, s.created_at DESC`,
        [candidateId],
      );
      if (rows.length === 1) {
        targetSubmission = rows[0];
      } else if (rows.length > 1) {
        log.warn(`[PRISM-RELAY] Ambiguous candidate correlation: ${rows.length} pending submissions for candidate ${candidateId}`);
        return res.status(200).json({
          status: "ambiguous_or_not_found",
          message: "Multiple active pending submissions found for candidate. Manual review required.",
          candidateId,
          count: rows.length,
        });
      }
    }

    // Never match by email alone — shared mailboxes would update the wrong person.
    if (!targetSubmission) {
      log.warn(`[PRISM-RELAY] Could not correlate consent response to a PRISM submission:`, req.body);
      return res.status(200).json({ status: "ambiguous_or_not_found", message: "No matching consent submission for this candidate. Reply was not applied to anyone else." });
    }

    // Sender security check
    if (senderEmail) {
      const { rows: candRows } = await pool.query(`SELECT id, email::text AS email, full_name FROM core.people WHERE id = $1`, [targetSubmission.candidate_id]);
      const cand = candRows[0];
      if (candidateId && cand && cand.id !== candidateId) {
        log.warn(`[PRISM-RELAY] Security check failed: payload candidate ${candidateId} != submission candidate ${cand.id}`);
        return res.status(403).json({ status: "failed", error: "Consent reply does not belong to this candidate." });
      }
      if (cand && cand.email && cand.email.toLowerCase().trim() !== senderEmail.toLowerCase().trim()) {
        log.warn(`[PRISM-RELAY] Security check failed: sender ${senderEmail} does not match candidate email ${cand.email}`);
        return res.status(403).json({ status: "failed", error: "Sender email does not match candidate record." });
      }
    }

    // Idempotency
    if (normalizedResponse === "ACCEPTED" && targetSubmission.status !== "PENDING_CONSENT" && targetSubmission.status !== "DRAFT") {
      log.info(`[PRISM-RELAY] Submission ${targetSubmission.id} is already in status '${targetSubmission.status}'. Skipping duplicate transition.`);
      return res.json({ status: "already_processed", submissionId: targetSubmission.id, currentStatus: targetSubmission.status });
    }
    if (normalizedResponse === "REJECTED" && targetSubmission.status === "CONSENT_REJECTED") {
      return res.json({ status: "already_processed", submissionId: targetSubmission.id, currentStatus: targetSubmission.status });
    }

    const updated = await prismWorkflow.recordCandidateConsentResponse(targetSubmission.id, targetSubmission.created_by, {
      response: normalizedResponse,
      notes: notes ? `[RELAY Inbound Email ${messageId ? `msg:${messageId}` : ""}] ${notes}` : `[RELAY Inbound Email]`,
    });

    log.info(`[PRISM-RELAY] Successfully transitioned submission ${targetSubmission.id} to ${updated.status}`);
    res.json({
      status: "success",
      submissionId: targetSubmission.id,
      newStatus: updated.status,
      candidateValidationResults: updated.candidate_validation_results || null,
    });
  } catch (err) {
    fail(res, err, "[PRISM-RELAY] Failed to process consent response for submission");
  }
});

/**
 * Vendor reply to a submitted profile.
 */
router.post("/internal/prism/vendor/response", async (req, res) => {
  const { submissionId, candidateId, jobId, senderEmail, response, notes, messageId, threadId } = req.body || {};

  log.info(`[PRISM-RELAY] Inbound vendor response received:`, { submissionId, candidateId, jobId, senderEmail, response, messageId, threadId });

  if (!response || !["ACCEPTED", "REJECTED", "APPROVED", "DECLINED", "NO", "YES"].includes(String(response).toUpperCase())) {
    return res.status(400).json({ status: "failed", error: "Valid response ('ACCEPTED' or 'REJECTED') is required." });
  }
  const normalizedResponse = YES.includes(String(response).toUpperCase()) ? "ACCEPTED" : "REJECTED";

  // The sender is a vendor; the vendor is on the requirement.
  const BY_VENDOR_EMAIL = `
    JOIN core.requirements j ON j.id = s.requirement_id
    JOIN core.vendors v ON v.id = j.vendor_id
    WHERE LOWER(TRIM(v.email)) = LOWER(TRIM($1))`;

  try {
    let targetSubmission = null;

    if (submissionId) {
      const { rows } = await pool.query(`SELECT ${SUB} FROM prism.submissions s WHERE s.id = $1`, [submissionId]);
      targetSubmission = rows[0] || null;
    }

    if (!targetSubmission && candidateId && jobId) {
      const { rows } = await pool.query(
        `SELECT ${SUB} FROM prism.submissions s
         WHERE s.person_id = $1
           AND (s.requirement_id = $2 OR s.requirement_id::text LIKE $3)
           AND s.status IN ('VENDOR_SUBMITTED', 'MASKED', 'CANDIDATE_VALIDATED')
         ORDER BY s.updated_at DESC
         LIMIT 1`,
        [candidateId, jobId, `${String(jobId).slice(0, 8)}%`],
      );
      targetSubmission = rows[0] || null;
    }

    if (!targetSubmission && senderEmail && jobId) {
      const { rows } = await pool.query(
        `SELECT ${SUB} FROM prism.submissions s
         ${BY_VENDOR_EMAIL}
           AND (s.requirement_id = $2 OR s.requirement_id::text LIKE $3)
           AND s.status IN ('VENDOR_SUBMITTED', 'MASKED', 'CANDIDATE_VALIDATED')
         ORDER BY s.updated_at DESC
         LIMIT 1`,
        [senderEmail, jobId, `${String(jobId).slice(0, 8)}%`],
      );
      targetSubmission = rows[0] || null;
    }

    if (!targetSubmission && candidateId) {
      const { rows } = await pool.query(
        `SELECT ${SUB} FROM prism.submissions s
         WHERE s.person_id = $1 AND s.status IN ('VENDOR_SUBMITTED', 'MASKED')
         ORDER BY s.updated_at DESC
         LIMIT 1`,
        [candidateId],
      );
      targetSubmission = rows[0] || null;
    }

    if (!targetSubmission && senderEmail) {
      const { rows } = await pool.query(
        `SELECT ${SUB} FROM prism.submissions s
         ${BY_VENDOR_EMAIL}
           AND s.status = 'VENDOR_SUBMITTED'
         ORDER BY s.updated_at DESC
         LIMIT 1`,
        [senderEmail],
      );
      targetSubmission = rows[0] || null;
    }

    if (!targetSubmission) {
      log.warn(`[PRISM-RELAY] Could not correlate vendor response to a PRISM submission:`, req.body);
      return res.status(200).json({ status: "ambiguous_or_not_found", message: "No active VENDOR_SUBMITTED submission found matching correlation criteria." });
    }

    if (normalizedResponse === "ACCEPTED" && targetSubmission.status === "VENDOR_ACCEPTED") {
      log.info(`[PRISM-RELAY] Submission ${targetSubmission.id} is already in status 'VENDOR_ACCEPTED'. Skipping duplicate transition.`);
      return res.json({ status: "already_processed", submissionId: targetSubmission.id, currentStatus: targetSubmission.status });
    }
    if (normalizedResponse === "REJECTED" && targetSubmission.status === "REJECTED") {
      return res.json({ status: "already_processed", submissionId: targetSubmission.id, currentStatus: targetSubmission.status });
    }

    const updated = await prismWorkflow.recordVendorResponse(targetSubmission.id, targetSubmission.created_by, {
      response: normalizedResponse,
      notes: notes ? `[RELAY Inbound Vendor Reply ${messageId ? `msg:${messageId}` : ""}] ${notes}` : `[RELAY Inbound Vendor Reply]`,
    });

    log.info(`[PRISM-RELAY] Successfully transitioned submission ${targetSubmission.id} to ${updated.status} from vendor reply`);
    res.json({ status: "success", submissionId: targetSubmission.id, newStatus: updated.status });
  } catch (err) {
    fail(res, err, "[PRISM-RELAY] Failed to process vendor response for submission");
  }
});

/**
 * Consultant or vendor confirmation of rate and availability.
 */
router.post("/internal/prism/confirmation/response", async (req, res) => {
  const { submissionId, candidateId, jobId, party, response, notes, messageId, senderEmail } = req.body || {};

  log.info(`[PRISM-RELAY] Inbound confirmation response received:`, { submissionId, party, response, senderEmail, messageId });

  if (!party || !["CONSULTANT", "VENDOR"].includes(String(party).toUpperCase())) {
    return res.status(400).json({ status: "failed", error: "party ('consultant' or 'vendor') is required." });
  }
  const normalizedParty = String(party).toUpperCase();
  const normalizedResponse = [...YES, "CONFIRMED"].includes(String(response).toUpperCase()) ? "CONFIRMED" : "DECLINED";

  try {
    let targetSubmission = null;
    if (submissionId) {
      const { rows } = await pool.query(`SELECT ${SUB} FROM prism.submissions s WHERE s.id = $1`, [submissionId]);
      targetSubmission = rows[0] || null;
    }
    if (!targetSubmission && candidateId && jobId) {
      const { rows } = await pool.query(
        `SELECT ${SUB} FROM prism.submissions s WHERE s.person_id = $1 AND s.requirement_id = $2 ORDER BY s.created_at DESC LIMIT 1`,
        [candidateId, jobId],
      );
      targetSubmission = rows[0] || null;
    }
    if (!targetSubmission) {
      return res.status(200).json({ status: "ambiguous_or_not_found", message: "No active submission found matching correlation criteria." });
    }

    const updated = normalizedParty === "CONSULTANT"
      ? await prismWorkflow.recordConsultantConfirmationResponse(targetSubmission.id, targetSubmission.created_by, { response: normalizedResponse, notes })
      : await prismWorkflow.recordVendorConfirmationResponse(targetSubmission.id, targetSubmission.created_by, { response: normalizedResponse, notes });

    res.json({ status: "success", submissionId: targetSubmission.id, party: normalizedParty, confirmationStatus: normalizedResponse, newStatus: updated.status });
  } catch (err) {
    fail(res, err, "[PRISM-RELAY] Failed to process confirmation response");
  }
});

/**
 * Vendor's right-to-represent reply.
 */
router.post("/internal/prism/rtr/response", async (req, res) => {
  const { submissionId, jobId, response, notes, messageId, senderEmail } = req.body || {};

  log.info(`[PRISM-RELAY] Inbound RTR response received:`, { submissionId, response, senderEmail, messageId });

  const normalizedResponse = [...YES, "SIGNED", "CONFIRMED"].includes(String(response).toUpperCase()) ? "SIGNED" : "DECLINED";

  try {
    let targetSubmission = null;
    if (submissionId) {
      const { rows } = await pool.query(`SELECT ${SUB} FROM prism.submissions s WHERE s.id = $1`, [submissionId]);
      targetSubmission = rows[0] || null;
    }
    if (!targetSubmission && jobId) {
      const { rows } = await pool.query(
        `SELECT ${SUB} FROM prism.submissions s WHERE s.requirement_id = $1 AND s.status = 'PENDING_RTR' ORDER BY s.created_at DESC LIMIT 1`,
        [jobId],
      );
      targetSubmission = rows[0] || null;
    }
    if (!targetSubmission) {
      return res.status(200).json({ status: "ambiguous_or_not_found", message: "No active PENDING_RTR submission found matching correlation criteria." });
    }

    if (normalizedResponse === "SIGNED" && targetSubmission.status === "RTR_CONFIRMED") {
      return res.json({ status: "already_processed", submissionId: targetSubmission.id, currentStatus: targetSubmission.status });
    }
    if (normalizedResponse === "DECLINED" && targetSubmission.status === "REJECTED") {
      return res.json({ status: "already_processed", submissionId: targetSubmission.id, currentStatus: targetSubmission.status });
    }

    const updated = await prismWorkflow.recordRTRStatus(targetSubmission.id, targetSubmission.created_by, { status: normalizedResponse, notes });
    res.json({ status: "success", submissionId: targetSubmission.id, rtrStatus: normalizedResponse, newStatus: updated.status });
  } catch (err) {
    fail(res, err, "[PRISM-RELAY] Failed to process RTR response");
  }
});

module.exports = router;
