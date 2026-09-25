const prismRepo = require("../repositories/prism.repository");
const candidateRepo = require("../../../repositories/candidate.repository");
const jobRepo = require("../../../repositories/job.repository");
const resumeRepo = require("../../../repositories/resume.repository");
const prismWorkflow = require("./prism.workflow.service");
const { pool } = require("../../../config/db");
const log = require("../../../utils/logger");

function createError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

// -----------------------------------------------------------------------------
// Submissions CRUD & Listing
// -----------------------------------------------------------------------------
async function createSubmission({ candidateId, resumeId, jobId, matchId, userId }) {
  log.info(`[PRISM-SUBMIT] Creating submission: candidate=${candidateId}, job=${jobId}, user=${userId}`);

  // Step 1 - Candidate Validation
  const candidate = await candidateRepo.getCandidateWithCurrentResume(candidateId, userId);
  if (!candidate) {
    throw createError("Candidate not found or does not belong to you.", 404);
  }
  if (candidate.status === "Staging") {
    await candidateRepo.saveCandidatesBulk([candidateId], userId);
  }

  // Step 2 - Resume Validation
  const resume = await resumeRepo.getResumeById(resumeId);
  if (!resume || resume.candidate_id !== candidateId) {
    throw createError("The supplied resume does not belong to this candidate.", 400);
  }
  if (!resume.raw_text && !resume.resume_summary && !candidate.full_name) {
    throw createError("Resume contains no readable text or candidate data.", 400);
  }

  // Step 3 - Job Validation
  const job = await jobRepo.getJobById(jobId, userId);
  if (!job) {
    throw createError("Job not found or does not belong to you.", 404);
  }

  // Step 4 - Duplicate active submission
  const duplicate = await prismRepo.findActiveDuplicateSubmission(candidateId, jobId, userId);
  if (duplicate) {
    throw createError("A PRISM submission already exists for this candidate and job.", 409);
  }

  // Step 5 - Create Submission
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = await prismRepo.createSubmission(client, {
      candidateId,
      resumeId,
      jobId,
      matchId,
      status: "DRAFT",
      createdBy: userId,
    });

    await prismRepo.insertAuditLog(client, {
      entityType: "SUBMISSION",
      entityId: created.id,
      previousStatus: null,
      newStatus: "DRAFT",
      createdBy: userId,
    });

    await client.query("COMMIT");
    return created;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function listSubmissions(userId, filters, include) {
  if (include === "details") {
    return await prismRepo.listEnrichedSubmissions(userId, filters);
  }
  return await prismRepo.listSubmissions(userId, filters);
}

async function getSubmissionById(submissionId, userId) {
  const submission = await prismRepo.getSubmissionById(submissionId, userId);
  if (!submission) {
    throw createError("Submission not found.", 404);
  }
  return submission;
}

// -----------------------------------------------------------------------------
// State Machine Protected Status Transition
// -----------------------------------------------------------------------------
async function updateSubmissionStatus(submissionId, status, userId, metadata = {}) {
  return await prismWorkflow.transitionStatus(submissionId, userId, status, metadata);
}

// -----------------------------------------------------------------------------
// Rate & Availability
// -----------------------------------------------------------------------------
async function updateSubmissionRateAvailability(submissionId, userId, payload = {}) {
  const finalRateType = payload.rateType || payload.rate_type;
  return await prismWorkflow.confirmRateAndAvailability(submissionId, userId, {
    ...payload,
    rateType: finalRateType,
  });
}

// -----------------------------------------------------------------------------
// Candidate Consent & Validation Endpoints
// -----------------------------------------------------------------------------
async function requestCandidateConsent(submissionId, userId, payload = {}) {
  return await prismWorkflow.requestCandidateConsent(submissionId, userId, payload);
}

async function getConsentPreview(submissionId, userId, payload = {}) {
  return await prismWorkflow.getConsentPreview(submissionId, userId, payload);
}

async function getVendorPreview(submissionId, userId, options = {}) {
  return await prismWorkflow.getVendorPreview(submissionId, userId, options);
}

async function getConsultantConfirmationPreview(submissionId, userId) {
  return await prismWorkflow.getConsultantConfirmationPreview(submissionId, userId);
}

async function getVendorConfirmationPreview(submissionId, userId) {
  return await prismWorkflow.getVendorConfirmationPreview(submissionId, userId);
}

async function sendConsultantConfirmation(submissionId, userId) {
  return await prismWorkflow.sendConsultantConfirmation(submissionId, userId);
}

async function sendVendorConfirmation(submissionId, userId) {
  return await prismWorkflow.sendVendorConfirmation(submissionId, userId);
}

async function recordConsultantConfirmationResponse(submissionId, userId, payload = {}) {
  return await prismWorkflow.recordConsultantConfirmationResponse(submissionId, userId, payload);
}

async function recordVendorConfirmationResponse(submissionId, userId, payload = {}) {
  return await prismWorkflow.recordVendorConfirmationResponse(submissionId, userId, payload);
}

async function recordCandidateConsentResponse(submissionId, userId, payload = {}) {
  return await prismWorkflow.recordCandidateConsentResponse(submissionId, userId, payload);
}

async function validateCandidate(submissionId, userId) {
  return await prismWorkflow.validateCandidate(submissionId, userId);
}

async function getMaskedProfile(submissionId, userId) {
  const submission = await prismRepo.getSubmissionById(submissionId, userId);
  if (!submission) throw createError("Submission not found.", 404);

  if (submission.maskedProfile && submission.maskedProfile.maskedCandidateId) {
    return submission.maskedProfile;
  }

  const candidate = await candidateRepo.getCandidateWithCurrentResume(submission.candidateId, userId);
  const resume = await resumeRepo.getResumeById(submission.resumeId);
  const job = await jobRepo.getJobById(submission.jobId, userId);
  return prismWorkflow.buildMaskedProfile(candidate, resume, job);
}

async function maskCandidateDetails(submissionId, userId, payload = {}) {
  return await prismWorkflow.maskCandidateDetails(submissionId, userId, payload.maskedProfile);
}

// -----------------------------------------------------------------------------
// Vendor Workflow Endpoints
// -----------------------------------------------------------------------------
async function sendToVendor(submissionId, userId, options = {}) {
  return await prismWorkflow.sendToVendor(submissionId, userId, options);
}

async function recordVendorResponse(submissionId, userId, payload = {}) {
  return await prismWorkflow.recordVendorResponse(submissionId, userId, payload);
}

async function validateVendor(submissionId, userId) {
  return await prismWorkflow.validateVendor(submissionId, userId);
}

// -----------------------------------------------------------------------------
// Availability & Rate Explicit Steps
// -----------------------------------------------------------------------------
async function confirmAvailability(submissionId, userId, payload = {}) {
  return await prismWorkflow.confirmAvailability(submissionId, userId, payload);
}

async function confirmRate(submissionId, userId, payload = {}) {
  return await prismWorkflow.confirmRate(submissionId, userId, payload);
}

// -----------------------------------------------------------------------------
// RTR (Right to Represent)
// -----------------------------------------------------------------------------
async function createRTR({ submissionId, status, documentUrl, userId }) {
  return await prismWorkflow.initiateRTR(submissionId, userId, { status, documentUrl });
}

async function getRTRBySubmissionId(submissionId, userId) {
  const rtr = await prismRepo.getRTRBySubmissionId(submissionId, userId);
  if (!rtr) throw createError("RTR not found.", 404);
  return rtr;
}

async function updateRTRStatus(rtrId, submissionId, status, userId, documentUrl = null) {
  return await prismWorkflow.recordRTRStatus(submissionId, userId, { status, documentUrl });
}

// -----------------------------------------------------------------------------
// Interview & Final Steps
// -----------------------------------------------------------------------------
async function scheduleInterview(submissionId, userId, payload = {}) {
  return await prismWorkflow.scheduleInterview(submissionId, userId, payload);
}

async function runFinalValidation(submissionId, userId) {
  return await prismWorkflow.executeFinalValidation(submissionId, userId);
}

async function submitFinalSubmission(submissionId, userId) {
  return await prismWorkflow.submitFinalSubmission(submissionId, userId);
}

// -----------------------------------------------------------------------------
// Audit Log History
// -----------------------------------------------------------------------------
async function getAuditHistory(submissionId, userId) {
  const submission = await prismRepo.getRawSubmissionById(null, submissionId, userId);
  if (!submission) throw createError("Submission not found or unauthorized.", 404);
  return await prismRepo.getAuditHistory(submissionId, userId);
}

// -----------------------------------------------------------------------------
// Consents & Approvals (Legacy Compatibility)
// -----------------------------------------------------------------------------
async function createConsent({ submissionId, status, notes, userId }) {
  const submission = await prismRepo.getRawSubmissionById(null, submissionId, userId);
  if (!submission) throw createError("Submission not found.", 404);

  const existingConsents = await prismRepo.getConsentBySubmissionId(submissionId, userId);
  if (existingConsents && existingConsents.length > 0) {
    throw createError("A Consent already exists for this submission.", 409);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = await prismRepo.createConsent(client, {
      submissionId,
      status: status || "PENDING",
      notes,
      createdBy: userId,
    });
    await prismRepo.insertAuditLog(client, {
      entityType: "CONSENT",
      entityId: created.id,
      previousStatus: null,
      newStatus: created.status,
      createdBy: userId,
    });
    await client.query("COMMIT");
    return created;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getConsentBySubmissionId(submissionId, userId) {
  return await prismRepo.getConsentBySubmissionId(submissionId, userId);
}

async function updateConsentStatus(consentId, submissionId, status, userId, notes = null) {
  return await recordCandidateConsentResponse(submissionId, userId, {
    response: status === "APPROVED" ? "ACCEPTED" : "REJECTED",
    notes,
  });
}

async function createApproval({ submissionId, status, notes, userId }) {
  const submission = await prismRepo.getRawSubmissionById(null, submissionId, userId);
  if (!submission) throw createError("Submission not found.", 404);

  const existingApproval = await prismRepo.getApprovalBySubmissionId(submissionId, userId);
  if (existingApproval) {
    throw createError("An Approval already exists for this submission.", 409);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = await prismRepo.createApproval(client, {
      submissionId,
      status: status || "PENDING",
      notes,
      createdBy: userId,
    });
    await prismRepo.insertAuditLog(client, {
      entityType: "APPROVAL",
      entityId: created.id,
      previousStatus: null,
      newStatus: created.status,
      createdBy: userId,
    });
    await client.query("COMMIT");
    return created;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getApprovalBySubmissionId(submissionId, userId) {
  const approval = await prismRepo.getApprovalBySubmissionId(submissionId, userId);
  if (!approval) throw createError("Approval not found.", 404);
  return approval;
}

async function updateApprovalStatus(approvalId, submissionId, status, userId, notes = null) {
  const existingApproval = await prismRepo.getApprovalBySubmissionId(submissionId, userId);
  if (!existingApproval || existingApproval.id !== approvalId) {
    throw createError("Approval not found or unauthorized.", 404);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await prismRepo.updateApprovalStatus(client, approvalId, submissionId, userId, status, notes);
    await prismRepo.insertAuditLog(client, {
      entityType: "APPROVAL",
      entityId: approvalId,
      previousStatus: existingApproval.status,
      newStatus: status,
      createdBy: userId,
    });
    await client.query("COMMIT");
    return updated;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------------------
// Recruiter Label (Business-level metadata, does NOT change PRISM state)
// -----------------------------------------------------------------------------
async function updateRecruiterLabel(submissionId, label, userId) {
  const submission = await prismRepo.getRawSubmissionById(null, submissionId, userId);
  if (!submission) {
    throw createError("Submission not found or unauthorized.", 404);
  }

  // Terminal states don't accept label changes
  const terminalStates = ['SUBMITTED', 'REJECTED', 'WITHDRAWN'];
  if (terminalStates.includes(submission.status)) {
    throw createError(`Cannot update label on a '${submission.status}' submission.`, 400);
  }

  const validLabels = [null, 'SELECTED', 'UNDER_REVIEW'];
  if (!validLabels.includes(label)) {
    throw createError(`Invalid label '${label}'. Must be one of: null, SELECTED, UNDER_REVIEW.`, 400);
  }

  const updated = await prismRepo.updateRecruiterLabel(submissionId, userId, label);
  if (!updated) {
    throw createError("Failed to update recruiter label.", 500);
  }

  log.info(`[PRISM-LABEL] Submission ${submissionId} label set to '${label}' by user ${userId}`);
  return updated;
}

// -----------------------------------------------------------------------------
// Delete Submission (DRAFT only)
// -----------------------------------------------------------------------------
async function deleteSubmission(submissionId, userId) {
  const result = await prismRepo.deleteSubmission(submissionId, userId);
  if (!result.deleted) {
    throw createError(result.reason || "Failed to delete submission.", 400);
  }
  log.info(`[PRISM-DELETE] Submission ${submissionId} deleted by user ${userId}`);
  return result;
}

module.exports = {
  createSubmission,
  listSubmissions,
  getSubmissionById,
  updateSubmissionStatus,
  updateSubmissionRateAvailability,

  requestCandidateConsent,
  getConsentPreview,
  getVendorPreview,
  getConsultantConfirmationPreview,
  getVendorConfirmationPreview,
  sendConsultantConfirmation,
  sendVendorConfirmation,
  recordConsultantConfirmationResponse,
  recordVendorConfirmationResponse,
  recordCandidateConsentResponse,
  validateCandidate,
  getMaskedProfile,
  maskCandidateDetails,
  sendToVendor,
  recordVendorResponse,
  validateVendor,
  confirmAvailability,
  confirmRate,
  scheduleInterview,
  runFinalValidation,
  submitFinalSubmission,

  createRTR,
  getRTRBySubmissionId,
  updateRTRStatus,

  createConsent,
  getConsentBySubmissionId,
  updateConsentStatus,

  createApproval,
  getApprovalBySubmissionId,
  updateApprovalStatus,

  getAuditHistory,

  updateRecruiterLabel,
  deleteSubmission,
};
