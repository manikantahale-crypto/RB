/**
 * PRISM's tables: prism.submissions, consents, rtr, approvals, audit.
 *
 * Ported from the old project's repositories/prism.repository.js (897 lines,
 * public.prism_* keyed into syntra.*) on 2026-09-18, ref/PRISM_Onboarding.md
 * stage 4. What changed, and only this:
 *
 *   public.prism_submissions  →  prism.submissions   (V20260909.64)
 *   candidate_id / job_id     →  person_id / requirement_id on the table;
 *                                every row this file returns still carries
 *                                `candidate_id` and `job_id` as aliases, so
 *                                the 2,600 lines of service and controller
 *                                code above it read exactly what they did.
 *   syntra.candidates/jobs/resumes, public.vendors
 *                             →  core.people / core.requirements / CORE_RESUMES /
 *                                core.vendors
 *   ensurePrismSchema()       →  gone. It rewrote foreign keys at boot; those
 *                                keys are in the migration now. Nothing here
 *                                runs DDL.
 *
 * Every query still scopes by created_by, as before: a recruiter sees their
 * own submissions. Tenant isolation on top of that is the row policy on each
 * table, not this file.
 */
const { pool } = require("../../../config/db");
const env = require("../../../config/env");
const { CORE_RESUMES } = require("../../../repositories/core-views");

/** The submission row as the services know it: new columns plus the old names. */
const SUB = `s.*, s.person_id AS candidate_id, s.requirement_id AS job_id`;
const SUB_RETURNING = `*, person_id AS candidate_id, requirement_id AS job_id`;

// -----------------------------------------------------------------------------
// Submissions CRUD
// -----------------------------------------------------------------------------
async function createSubmission(client, { candidateId, resumeId, jobId, matchId, status, createdBy }) {
  const dbClient = client || pool;
  const sql = `
    INSERT INTO prism.submissions (
      person_id, resume_id, requirement_id, match_id, status, created_by,
      candidate_validation_results, vendor_validation_results, masked_profile, interview_details
    )
    VALUES ($1, $2, $3, $4, COALESCE($5, 'DRAFT'), $6, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)
    RETURNING ${SUB_RETURNING}
  `;
  const { rows } = await dbClient.query(sql, [
    candidateId,
    resumeId,
    jobId,
    matchId || null,
    status || 'DRAFT',
    createdBy
  ]);
  return rows[0];
}

async function listSubmissions(userId, { status, candidateId, jobId, submissionId } = {}) {
  const params = [userId];
  let conditions = ["s.created_by = $1"];
  let paramIndex = 2;

  if (status) {
    conditions.push(`s.status = $${paramIndex++}`);
    params.push(status);
  }
  if (candidateId) {
    conditions.push(`s.person_id = $${paramIndex++}`);
    params.push(candidateId);
  }
  if (jobId) {
    conditions.push(`s.requirement_id = $${paramIndex++}`);
    params.push(jobId);
  }
  if (submissionId) {
    conditions.push(`s.id = $${paramIndex++}`);
    params.push(submissionId);
  }

  const sql = `
    SELECT ${SUB}
    FROM prism.submissions s
    WHERE ${conditions.join(" AND ")}
    ORDER BY s.created_at DESC
  `;
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function listEnrichedSubmissions(userId, filters = {}) {
  // 1. Fetch base submissions
  const submissions = await listSubmissions(userId, filters);
  if (!submissions.length) return [];

  // 2. Extract IDs
  const candidateIds = [...new Set(submissions.map(s => s.candidate_id))];
  const jobIds = [...new Set(submissions.map(s => s.job_id))];
  const submissionIds = submissions.map(s => s.id);

  const resumeIds = [...new Set(submissions.map(s => s.resume_id).filter(Boolean))];
  const candSql = `
    SELECT c.id, c.full_name, r.primary_role, r.total_experience, c.immigration_status, c.location, c.email, c.phone
    FROM core.people c
    LEFT JOIN core.resumes r ON r.person_id = c.id AND r.is_current = true
    WHERE c.id = ANY($1) AND c.created_by = $2
  `;
  const jobSql = `
    SELECT j.id as job_id, j.title, j.location, j.company_name, v.id as vendor_id, v.name as vendor_name, v.status as vendor_status, v.email as vendor_email, v.phone as vendor_phone, v.location as vendor_location
    FROM core.requirements j
    LEFT JOIN core.vendors v ON j.vendor_id = v.id AND v.created_by = $2
    WHERE j.id = ANY($1) AND j.created_by = $2
  `;
  const rtrSql = `
    SELECT DISTINCT ON (submission_id) id, submission_id, status, document_url, created_at
    FROM prism.rtr
    WHERE submission_id = ANY($1) AND created_by = $2
    ORDER BY submission_id, created_at DESC
  `;
  const consentSql = `
    SELECT DISTINCT ON (submission_id) id, submission_id, status, notes, created_at
    FROM prism.consents
    WHERE submission_id = ANY($1) AND created_by = $2
    ORDER BY submission_id, created_at DESC
  `;
  const approvalSql = `
    SELECT DISTINCT ON (submission_id) id, submission_id, status, notes, created_at
    FROM prism.approvals
    WHERE submission_id = ANY($1) AND created_by = $2
    ORDER BY submission_id, created_at DESC
  `;
  // raw_text, resume_summary and the processing_* columns are assembled by
  // CORE_RESUMES from core.source_files and core.processing_jobs.
  const resumeSql = `
    SELECT id, candidate_id, is_current,
           (raw_text IS NOT NULL AND length(raw_text) > 0) AS has_raw_text,
           (resume_summary IS NOT NULL AND length(resume_summary) > 0) AS has_summary,
           processing_status, processing_error, processed_at, created_at
    FROM ${CORE_RESUMES} r
    WHERE id = ANY($1)
  `;

  const [candResult, jobResult, rtrResult, consentResult, approvalResult, resumeResult] = await Promise.all([
    pool.query(candSql, [candidateIds, userId]),
    pool.query(jobSql, [jobIds, userId]),
    pool.query(rtrSql, [submissionIds, userId]),
    pool.query(consentSql, [submissionIds, userId]),
    pool.query(approvalSql, [submissionIds, userId]),
    resumeIds.length > 0 ? pool.query(resumeSql, [resumeIds]) : Promise.resolve({ rows: [] }),
  ]);

  const candidateMap = new Map(candResult.rows.map(c => [c.id, c]));
  const jobMap = new Map(jobResult.rows.map(j => [j.job_id, j]));
  const rtrMap = new Map(rtrResult.rows.map(r => [r.submission_id, r]));
  const consentMap = new Map(consentResult.rows.map(c => [c.submission_id, c]));
  const approvalMap = new Map(approvalResult.rows.map(a => [a.submission_id, a]));
  const resumeMap = new Map(resumeResult.rows.map(r => [r.id, r]));

  // 4. Map & Assemble
  return submissions.map(sub => {
    const cand = candidateMap.get(sub.candidate_id);
    const job = jobMap.get(sub.job_id);
    const rtr = rtrMap.get(sub.id);
    const consent = consentMap.get(sub.id);
    const approval = approvalMap.get(sub.id);
    const resume = resumeMap.get(sub.resume_id);

    const hasResumeText = Boolean(resume && (resume.has_raw_text || resume.has_summary || resume.raw_text || resume.resume_summary));
    const processingStatus = resume?.processing_status || (hasResumeText ? 'processed' : 'incomplete');

    return {
      id: sub.id,
      candidate_id: sub.candidate_id,
      candidateId: sub.candidate_id,
      resume_id: sub.resume_id,
      resumeId: sub.resume_id,
      job_id: sub.job_id,
      jobId: sub.job_id,
      matchId: sub.match_id,
      status: sub.status,
      recruiterLabel: sub.recruiter_label || null,
      rate: sub.rate,
      rateType: sub.rate_type,
      availability: sub.availability,
      createdAt: sub.created_at,
      updatedAt: sub.updated_at,
      candidateValidationResults: sub.candidate_validation_results || {},
      vendorValidationResults: sub.vendor_validation_results || {},
      maskedProfile: sub.masked_profile || {},
      interviewDetails: sub.interview_details || {},
      confirmationData: sub.confirmation_data || {},
      consultantConfirmation: sub.confirmation_data?.consultantConfirmation || { status: 'PENDING' },
      vendorConfirmation: sub.confirmation_data?.vendorConfirmation || { status: 'PENDING' },
      canInitiateRTR: Boolean(
        sub.status === 'RATE_CONFIRMED' &&
        sub.availability &&
        sub.rate &&
        sub.rate_type &&
        sub.confirmation_data?.consultantConfirmation?.status === 'CONFIRMED' &&
        sub.confirmation_data?.vendorConfirmation?.status === 'CONFIRMED'
      ),
      resumeValid: hasResumeText,
      resumeProcessingStatus: processingStatus,
      resumeProcessingError: resume?.processing_error || null,
      lastConsentSentAt: sub.last_consent_sent_at || null,
      consentResendCount: Number(sub.consent_resend_count || 0),
      maxConsentResends: env.CONSENT_MAX_RESENDS || 3,
      nextConsentResendAt: (() => {
        if (sub.status !== 'PENDING_CONSENT' || consent?.status !== 'REQUESTED') return null;
        if (!sub.last_consent_sent_at) return null;
        const cooldownMs = (env.CONSENT_RESEND_COOLDOWN_MINUTES || 60) * 60 * 1000;
        return new Date(new Date(sub.last_consent_sent_at).getTime() + cooldownMs).toISOString();
      })(),
      canResendConsent: (() => {
        if (sub.status !== 'PENDING_CONSENT' || consent?.status !== 'REQUESTED') return false;
        if (Number(sub.consent_resend_count || 0) >= (env.CONSENT_MAX_RESENDS || 3)) return false;
        if (!sub.last_consent_sent_at) return true;
        const cooldownMs = (env.CONSENT_RESEND_COOLDOWN_MINUTES || 60) * 60 * 1000;
        return new Date(sub.last_consent_sent_at).getTime() + cooldownMs <= Date.now();
      })(),

      candidate: cand ? {
        id: cand.id,
        fullName: cand.full_name,
        primaryRole: cand.primary_role,
        totalExperience: cand.total_experience,
        immigrationStatus: cand.immigration_status,
        location: cand.location,
        email: cand.email,
        phone: cand.phone
      } : null,

      job: job ? {
        id: job.job_id,
        title: job.title,
        location: job.location,
        companyName: job.company_name,
        vendorId: job.vendor_id
      } : null,

      vendor: job && job.vendor_id ? {
        id: job.vendor_id,
        name: job.vendor_name,
        status: job.vendor_status,
        email: job.vendor_email,
        phone: job.vendor_phone,
        location: job.vendor_location,
      } : null,

      rtr: rtr ? {
        id: rtr.id,
        status: rtr.status,
        documentUrl: rtr.document_url,
        createdAt: rtr.created_at
      } : null,

      consent: consent ? {
        id: consent.id,
        status: consent.status,
        notes: consent.notes,
        createdAt: consent.created_at
      } : null,

      approval: approval ? {
        id: approval.id,
        status: approval.status,
        notes: approval.notes,
        createdAt: approval.created_at
      } : null
    };
  });
}

async function getSubmissionById(submissionId, userId) {
  const enrichedList = await listEnrichedSubmissions(userId, { submissionId });
  const found = enrichedList[0];
  if (found) return found;

  const sql = `
    SELECT ${SUB} FROM prism.submissions s
    WHERE s.id = $1 AND s.created_by = $2
  `;
  const { rows } = await pool.query(sql, [submissionId, userId]);
  return rows[0] || null;
}

async function getRawSubmissionById(client, submissionId, userId) {
  const dbClient = client || pool;
  const sql = `
    SELECT ${SUB} FROM prism.submissions s
    WHERE s.id = $1 AND s.created_by = $2
  `;
  const { rows } = await dbClient.query(sql, [submissionId, userId]);
  return rows[0] || null;
}

async function getSubmissionForUpdate(client, submissionId, userId) {
  const dbClient = client || pool;
  const sql = `
    SELECT ${SUB} FROM prism.submissions s
    WHERE s.id = $1 AND s.created_by = $2
    FOR UPDATE
  `;
  const { rows } = await dbClient.query(sql, [submissionId, userId]);
  return rows[0] || null;
}

async function updateSubmissionStatus(client, submissionId, userId, status) {
  const dbClient = client || pool;
  const sql = `
    UPDATE prism.submissions
    SET status = $1, updated_at = now()
    WHERE id = $2 AND created_by = $3
    RETURNING ${SUB_RETURNING}
  `;
  const { rows } = await dbClient.query(sql, [status, submissionId, userId]);
  return rows[0] || null;
}

async function updateSubmissionWorkflowData(client, submissionId, userId, updates = {}) {
  const dbClient = client || pool;
  const setClauses = ["updated_at = now()"];
  const params = [submissionId, userId];
  let paramIndex = 3;

  if (updates.status !== undefined) {
    setClauses.push(`status = $${paramIndex++}`);
    params.push(updates.status);
  }
  if (updates.rate !== undefined) {
    setClauses.push(`rate = $${paramIndex++}`);
    params.push(updates.rate);
  }
  if (updates.rateType !== undefined || updates.rate_type !== undefined) {
    setClauses.push(`rate_type = $${paramIndex++}`);
    params.push(updates.rateType || updates.rate_type);
  }
  if (updates.availability !== undefined) {
    setClauses.push(`availability = $${paramIndex++}`);
    params.push(updates.availability);
  }
  if (updates.candidateValidationResults !== undefined || updates.candidate_validation_results !== undefined) {
    setClauses.push(`candidate_validation_results = $${paramIndex++}::jsonb`);
    params.push(JSON.stringify(updates.candidateValidationResults || updates.candidate_validation_results));
  }
  if (updates.vendorValidationResults !== undefined || updates.vendor_validation_results !== undefined) {
    setClauses.push(`vendor_validation_results = $${paramIndex++}::jsonb`);
    params.push(JSON.stringify(updates.vendorValidationResults || updates.vendor_validation_results));
  }
  if (updates.maskedProfile !== undefined || updates.masked_profile !== undefined) {
    setClauses.push(`masked_profile = $${paramIndex++}::jsonb`);
    params.push(JSON.stringify(updates.maskedProfile || updates.masked_profile));
  }
  if (updates.interviewDetails !== undefined || updates.interview_details !== undefined) {
    setClauses.push(`interview_details = $${paramIndex++}::jsonb`);
    params.push(JSON.stringify(updates.interviewDetails || updates.interview_details));
  }
  if (updates.lastConsentSentAt !== undefined || updates.last_consent_sent_at !== undefined) {
    setClauses.push(`last_consent_sent_at = $${paramIndex++}`);
    params.push(updates.lastConsentSentAt !== undefined ? updates.lastConsentSentAt : updates.last_consent_sent_at);
  }
  if (updates.consentResendCount !== undefined || updates.consent_resend_count !== undefined) {
    setClauses.push(`consent_resend_count = $${paramIndex++}`);
    params.push(updates.consentResendCount !== undefined ? updates.consentResendCount : updates.consent_resend_count);
  }

  const sql = `
    UPDATE prism.submissions
    SET ${setClauses.join(", ")}
    WHERE id = $1 AND created_by = $2
    RETURNING ${SUB_RETURNING}
  `;
  const { rows } = await dbClient.query(sql, params);
  return rows[0] || null;
}

async function updateSubmissionRateAvailability(client, submissionId, userId, { rate, rateType, availability }) {
  const dbClient = client || pool;
  const sql = `
    UPDATE prism.submissions
    SET rate = $1, rate_type = $2, availability = $3, updated_at = now()
    WHERE id = $4 AND created_by = $5
    RETURNING ${SUB_RETURNING}
  `;
  const { rows } = await dbClient.query(sql, [rate, rateType, availability, submissionId, userId]);
  return rows[0] || null;
}

async function findActiveDuplicateSubmission(arg1, arg2, arg3, arg4 = null, arg5 = null) {
  let client = null;
  let candidateId = null;
  let jobId = null;
  let userId = null;
  let excludeSubmissionId = null;

  if (arg1 && typeof arg1.query === "function") {
    client = arg1;
    candidateId = arg2;
    jobId = arg3;
    userId = arg4;
    excludeSubmissionId = arg5;
  } else {
    candidateId = arg1;
    jobId = arg2;
    userId = arg3;
    excludeSubmissionId = arg4;
    client = arg5;
  }

  const dbClient = client || pool;
  let sql = `
    SELECT ${SUB} FROM prism.submissions s
    WHERE s.person_id = $1
      AND s.requirement_id = $2
      AND s.created_by = $3
      AND s.status NOT IN ('REJECTED', 'WITHDRAWN')
  `;
  const params = [candidateId, jobId, userId];
  if (excludeSubmissionId) {
    sql += ` AND s.id != $4`;
    params.push(excludeSubmissionId);
  }
  sql += ` LIMIT 1`;
  const { rows } = await dbClient.query(sql, params);
  return rows[0] || null;
}

// -----------------------------------------------------------------------------
// RTR (Right to Represent)
// -----------------------------------------------------------------------------
async function createRTR(client, { submissionId, status, documentUrl, createdBy }) {
  const dbClient = client || pool;
  const sql = `
    INSERT INTO prism.rtr (submission_id, status, document_url, created_by)
    VALUES ($1, COALESCE($2, 'PENDING'), $3, $4)
    RETURNING *
  `;
  const { rows } = await dbClient.query(sql, [
    submissionId,
    status || 'PENDING',
    documentUrl || null,
    createdBy
  ]);
  return rows[0];
}

async function getRTRBySubmissionId(arg1, arg2, arg3 = null) {
  let client = null;
  let submissionId = null;
  let userId = null;

  if (arg3 !== null && arg3 !== undefined) {
    client = arg1;
    submissionId = arg2;
    userId = arg3;
  } else if (arg1 && typeof arg1.query === "function") {
    client = arg1;
    submissionId = arg2;
  } else {
    submissionId = arg1;
    userId = arg2;
    client = null;
  }

  const dbClient = client || pool;
  const sql = `
    SELECT r.*
    FROM prism.rtr r
    JOIN prism.submissions s ON r.submission_id = s.id
    WHERE r.submission_id = $1 AND s.created_by = $2
    ORDER BY r.created_at DESC
    LIMIT 1
  `;
  const { rows } = await dbClient.query(sql, [submissionId, userId]);
  return rows[0] || null;
}

async function updateRTRStatus(client, rtrId, submissionId, userId, status, documentUrl = null) {
  const dbClient = client || pool;
  let sql = `
    UPDATE prism.rtr
    SET status = $1, updated_at = now()
  `;
  const params = [status, rtrId, submissionId, userId];
  let paramIndex = 5;
  if (documentUrl) {
    sql += `, document_url = $${paramIndex++}`;
    params.push(documentUrl);
  }
  sql += `
    WHERE id = $2
      AND submission_id = $3
      AND created_by = $4
    RETURNING *
  `;
  const { rows } = await dbClient.query(sql, params);
  return rows[0] || null;
}

// -----------------------------------------------------------------------------
// Consents
// -----------------------------------------------------------------------------
async function createConsent(client, { submissionId, status, notes, createdBy }) {
  const dbClient = client || pool;
  const sql = `
    INSERT INTO prism.consents (submission_id, status, notes, created_by)
    VALUES ($1, COALESCE($2, 'PENDING'), $3, $4)
    RETURNING *
  `;
  const { rows } = await dbClient.query(sql, [
    submissionId,
    status || 'PENDING',
    notes || null,
    createdBy
  ]);
  return rows[0];
}

async function getConsentBySubmissionId(arg1, arg2, arg3 = null) {
  let client = null;
  let submissionId = null;
  let userId = null;

  if (arg3 !== null && arg3 !== undefined) {
    client = arg1;
    submissionId = arg2;
    userId = arg3;
  } else if (arg1 && typeof arg1.query === "function") {
    client = arg1;
    submissionId = arg2;
  } else {
    submissionId = arg1;
    userId = arg2;
    client = null;
  }

  const dbClient = client || pool;
  const sql = `
    SELECT c.*
    FROM prism.consents c
    JOIN prism.submissions s ON c.submission_id = s.id
    WHERE c.submission_id = $1 AND s.created_by = $2
    ORDER BY c.created_at DESC
  `;
  const { rows } = await dbClient.query(sql, [submissionId, userId]);
  return rows;
}

async function getLatestConsent(arg1, arg2, arg3 = null) {
  let client = null;
  let submissionId = null;
  let userId = null;

  if (arg3 !== null && arg3 !== undefined) {
    client = arg1;
    submissionId = arg2;
    userId = arg3;
  } else if (arg1 && typeof arg1.query === "function") {
    client = arg1;
    submissionId = arg2;
  } else {
    submissionId = arg1;
    userId = arg2;
    client = null;
  }

  const dbClient = client || pool;
  const sql = `
    SELECT c.*
    FROM prism.consents c
    JOIN prism.submissions s ON c.submission_id = s.id
    WHERE c.submission_id = $1 AND s.created_by = $2
    ORDER BY c.created_at DESC
    LIMIT 1
  `;
  const { rows } = await dbClient.query(sql, [submissionId, userId]);
  return rows[0] || null;
}

async function updateConsentStatus(client, consentId, submissionId, userId, status, notes = null) {
  const dbClient = client || pool;
  let sql = `
    UPDATE prism.consents
    SET status = $1, updated_at = now()
  `;
  const params = [status, consentId, submissionId, userId];
  let paramIndex = 5;
  if (notes) {
    sql += `, notes = $${paramIndex++}`;
    params.push(notes);
  }
  sql += `
    WHERE id = $2
      AND submission_id = $3
      AND created_by = $4
    RETURNING *
  `;
  const { rows } = await dbClient.query(sql, params);
  return rows[0] || null;
}

// -----------------------------------------------------------------------------
// Approvals
// -----------------------------------------------------------------------------
async function createApproval(client, { submissionId, status, notes, createdBy }) {
  const dbClient = client || pool;
  const sql = `
    INSERT INTO prism.approvals (submission_id, status, notes, created_by)
    VALUES ($1, COALESCE($2, 'PENDING'), $3, $4)
    RETURNING *
  `;
  const { rows } = await dbClient.query(sql, [
    submissionId,
    status || 'PENDING',
    notes || null,
    createdBy
  ]);
  return rows[0];
}

async function getApprovalBySubmissionId(submissionId, userId) {
  const sql = `
    SELECT a.*
    FROM prism.approvals a
    JOIN prism.submissions s ON a.submission_id = s.id
    WHERE a.submission_id = $1 AND s.created_by = $2
    ORDER BY a.created_at DESC
    LIMIT 1
  `;
  const { rows } = await pool.query(sql, [submissionId, userId]);
  return rows[0] || null;
}

async function updateApprovalStatus(client, approvalId, submissionId, userId, status, notes = null) {
  const dbClient = client || pool;
  let sql = `
    UPDATE prism.approvals
    SET status = $1, updated_at = now()
  `;
  const params = [status, approvalId, submissionId, userId];
  let paramIndex = 5;
  if (notes) {
    sql += `, notes = $${paramIndex++}`;
    params.push(notes);
  }
  sql += `
    WHERE id = $2
      AND submission_id = $3
      AND created_by = $4
    RETURNING *
  `;
  const { rows } = await dbClient.query(sql, params);
  return rows[0] || null;
}

// -----------------------------------------------------------------------------
// Audit
// -----------------------------------------------------------------------------
async function insertAuditLog(client, { entityType, entityId, previousStatus, newStatus, createdBy }) {
  const dbClient = client || pool;
  const sql = `
    INSERT INTO prism.audit (entity_type, entity_id, previous_status, new_status, created_by)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;
  const { rows } = await dbClient.query(sql, [
    entityType || 'SUBMISSION',
    entityId,
    previousStatus || null,
    newStatus,
    createdBy
  ]);
  return rows[0];
}

async function getAuditHistory(submissionId, userId) {
  const sql = `
    SELECT a.*
    FROM prism.audit a
    JOIN prism.submissions s ON a.entity_id = s.id
    WHERE a.entity_id = $1 AND s.created_by = $2
    ORDER BY a.created_at ASC
  `;
  const { rows } = await pool.query(sql, [submissionId, userId]);
  return rows;
}

// -----------------------------------------------------------------------------
// Recruiter Label (Business-level metadata, does NOT affect PRISM state machine)
// -----------------------------------------------------------------------------
async function updateRecruiterLabel(submissionId, userId, label) {
  const validLabels = [null, 'SELECTED', 'UNDER_REVIEW'];
  if (!validLabels.includes(label)) {
    throw new Error(`Invalid recruiter label: '${label}'. Must be one of: ${validLabels.join(', ')}`);
  }
  const sql = `
    UPDATE prism.submissions
    SET recruiter_label = $1, updated_at = now()
    WHERE id = $2 AND created_by = $3
    RETURNING ${SUB_RETURNING}
  `;
  const { rows } = await pool.query(sql, [label, submissionId, userId]);
  return rows[0] || null;
}

// -----------------------------------------------------------------------------
// Consent auto-resend
// -----------------------------------------------------------------------------
async function findEligibleAutoResendSubmissions(client, { cooldownMinutes = 60, maxResends = 3 } = {}) {
  const dbClient = client || pool;
  const cooldownThreshold = new Date(Date.now() - cooldownMinutes * 60 * 1000);
  const sql = `
    SELECT s.id, s.created_by, s.person_id AS candidate_id, s.requirement_id AS job_id,
           s.consent_resend_count, s.last_consent_sent_at
    FROM prism.submissions s
    INNER JOIN LATERAL (
      SELECT c.status
      FROM prism.consents c
      WHERE c.submission_id = s.id
      ORDER BY c.created_at DESC
      LIMIT 1
    ) lc ON lc.status = 'REQUESTED'
    WHERE s.status = 'PENDING_CONSENT'
      AND s.consent_resend_count < $1
      AND (s.last_consent_sent_at IS NULL OR s.last_consent_sent_at <= $2)
    ORDER BY s.last_consent_sent_at ASC NULLS FIRST;
  `;
  const { rows } = await dbClient.query(sql, [maxResends, cooldownThreshold]);
  return rows;
}

// -----------------------------------------------------------------------------
// Delete Submission (only DRAFT allowed)
// -----------------------------------------------------------------------------
async function deleteSubmission(submissionId, userId) {
  // Verify ownership and status
  const checkSql = `
    SELECT id, status FROM prism.submissions
    WHERE id = $1 AND created_by = $2
  `;
  const { rows: checkRows } = await pool.query(checkSql, [submissionId, userId]);
  if (!checkRows.length) return { deleted: false, reason: 'Submission not found or unauthorized.' };
  if (checkRows[0].status !== 'DRAFT') {
    return { deleted: false, reason: `Cannot delete submission in '${checkRows[0].status}' state. Only DRAFT submissions can be deleted.` };
  }

  // consents, rtr and approvals cascade from the submission (V20260909.64);
  // audit rows are detached first so they survive the delete.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await insertAuditLog(client, {
      entityType: 'SUBMISSION',
      entityId: submissionId,
      previousStatus: 'DRAFT',
      newStatus: 'DELETED',
      createdBy: userId
    });
    await client.query(
      `UPDATE prism.audit SET entity_type = 'SUBMISSION_DELETED' WHERE entity_id = $1`,
      [submissionId]
    );
    await client.query(
      `DELETE FROM prism.submissions WHERE id = $1 AND created_by = $2`,
      [submissionId, userId]
    );
    await client.query('COMMIT');
    return { deleted: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createSubmission,
  listSubmissions,
  listEnrichedSubmissions,
  getSubmissionById,
  getRawSubmissionById,
  getSubmissionForUpdate,
  updateSubmissionStatus,
  updateSubmissionWorkflowData,
  updateSubmissionRateAvailability,
  findActiveDuplicateSubmission,
  findEligibleAutoResendSubmissions,

  createRTR,
  getRTRBySubmissionId,
  updateRTRStatus,

  createConsent,
  getConsentBySubmissionId,
  getLatestConsent,
  updateConsentStatus,

  createApproval,
  getApprovalBySubmissionId,
  updateApprovalStatus,

  insertAuditLog,
  getAuditHistory,

  updateRecruiterLabel,
  deleteSubmission
};
