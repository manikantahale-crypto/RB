const prismService = require("../services/prism.service");
const log = require("../../../utils/logger");

// -----------------------------------------------------------------------------
// Submissions CRUD
// -----------------------------------------------------------------------------
async function createSubmission(req, res, next) {
  try {
    const userId = req.userId;
    const { candidateId, resumeId, jobId, matchId } = req.body;

    const submission = await prismService.createSubmission({
      candidateId,
      resumeId,
      jobId,
      matchId,
      userId,
    });

    res.status(201).json({ data: submission });
  } catch (err) {
    next(err);
  }
}

async function listSubmissions(req, res, next) {
  try {
    const userId = req.userId;
    const { status, candidateId, jobId, include } = req.query;

    const submissions = await prismService.listSubmissions(userId, { status, candidateId, jobId }, include);
    res.json({ data: submissions });
  } catch (err) {
    next(err);
  }
}

async function getSubmissionById(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;

    const submission = await prismService.getSubmissionById(submissionId, userId);
    res.json({ data: submission });
  } catch (err) {
    next(err);
  }
}

async function getSubmissionStatus(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;

    const submission = await prismService.getSubmissionById(submissionId, userId);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found or unauthorized." });
    }

    res.json({
      data: {
        id: submission.id,
        status: submission.status,
        submissionStatus: submission.status,
        updatedAt: submission.updated_at,
        createdAt: submission.created_at,
        rate: submission.rate,
        rateType: submission.rate_type,
        availability: submission.availability,
        recruiterLabel: submission.recruiter_label,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function updateSubmissionStatus(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const { status, ...metadata } = req.body;

    const updated = await prismService.updateSubmissionStatus(submissionId, status, userId, metadata);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
}

async function updateSubmissionRateAvailability(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const {
      rate,
      rate_type,
      rateType,
      availability,
      vendorId,
      vendor_id,
      candidateName,
      candidatePhone,
      candidateEmail,
      candidateLocation,
      candidateWorkAuth,
      brief,
    } = req.body || {};

    const finalRateType = rateType || rate_type;
    const finalVendorId = vendorId || vendor_id;
    const candidateUpdates = {};
    if (candidateName) candidateUpdates.full_name = candidateName;
    if (candidatePhone) candidateUpdates.phone = candidatePhone;
    if (candidateEmail) candidateUpdates.email = candidateEmail;
    if (candidateLocation) candidateUpdates.location = candidateLocation;
    if (candidateWorkAuth) candidateUpdates.immigration_status = candidateWorkAuth;

    const updated = await prismService.updateSubmissionRateAvailability(submissionId, userId, {
      rate,
      rateType: finalRateType,
      availability,
      vendorId: finalVendorId,
      candidateUpdates: Object.keys(candidateUpdates).length > 0 ? candidateUpdates : null,
      brief,
    });
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
}

// -----------------------------------------------------------------------------
// Candidate Workflow Endpoints
// -----------------------------------------------------------------------------
async function requestCandidateConsent(req, res, next) {
  const start = Date.now();
  const reqId = req.id || req.requestId || "unknown";
  const userId = req.userId;
  const { submissionId } = req.params;
  const { notes, contractType } = req.body || {};

  log.debug(`[request=${reqId}] [prism.consent] Controller received request submissionId=${submissionId} userId=${userId}`);
  try {
    const updated = await prismService.requestCandidateConsent(submissionId, userId, {
      notes,
      contractType,
      requestId: reqId,
    });
    const elapsed = Date.now() - start;
    log.debug(`[request=${reqId}] [prism.consent] Controller succeeded status=200 duration=${elapsed}ms submissionId=${submissionId}`);
    res.status(200).json({ data: updated });
  } catch (err) {
    const elapsed = Date.now() - start;
    log.debug(`[request=${reqId}] [prism.consent] Controller failed duration=${elapsed}ms status=${err.statusCode || 500} error=${err.message}`);
    next(err);
  }
}

async function getConsentPreview(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const contractType = req.query.contractType || req.query.contract_type || undefined;

    const preview = await prismService.getConsentPreview(submissionId, userId, { contractType });
    res.status(200).json({ data: preview });
  } catch (err) {
    next(err);
  }
}

async function recordCandidateConsentResponse(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const { response, notes } = req.body;

    const updated = await prismService.recordCandidateConsentResponse(submissionId, userId, { response, notes });
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
}

async function validateCandidate(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;

    const result = await prismService.validateCandidate(submissionId, userId);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
}

async function getMaskedProfile(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;

    const masked = await prismService.getMaskedProfile(submissionId, userId);
    res.json({ data: masked });
  } catch (err) {
    next(err);
  }
}

async function maskCandidateDetails(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const { maskedProfile } = req.body;

    const updated = await prismService.maskCandidateDetails(submissionId, userId, { maskedProfile });
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
}

async function getVendorPreview(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const { vendorId } = req.query;

    const preview = await prismService.getVendorPreview(submissionId, userId, { vendorId });
    res.status(200).json({ data: preview });
  } catch (err) {
    next(err);
  }
}

async function getConsultantConfirmationPreview(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const preview = await prismService.getConsultantConfirmationPreview(submissionId, userId);
    res.status(200).json({ data: preview });
  } catch (err) {
    next(err);
  }
}

async function getVendorConfirmationPreview(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const preview = await prismService.getVendorConfirmationPreview(submissionId, userId);
    res.status(200).json({ data: preview });
  } catch (err) {
    next(err);
  }
}

async function sendConsultantConfirmation(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const updated = await prismService.sendConsultantConfirmation(submissionId, userId);
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
}

async function sendVendorConfirmation(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const updated = await prismService.sendVendorConfirmation(submissionId, userId);
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
}

async function recordConsultantConfirmationResponse(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const { response, notes } = req.body || {};
    const updated = await prismService.recordConsultantConfirmationResponse(submissionId, userId, { response, notes });
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
}

async function recordVendorConfirmationResponse(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const { response, notes } = req.body || {};
    const updated = await prismService.recordVendorConfirmationResponse(submissionId, userId, { response, notes });
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
}

// -----------------------------------------------------------------------------
// Vendor Workflow Endpoints
// -----------------------------------------------------------------------------
async function sendToVendor(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const { vendorId } = req.body || {};

    const updated = await prismService.sendToVendor(submissionId, userId, { vendorId });
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
}

async function recordVendorResponse(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const { response, notes } = req.body;

    const updated = await prismService.recordVendorResponse(submissionId, userId, { response, notes });
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
}

async function validateVendor(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;

    const updated = await prismService.validateVendor(submissionId, userId);
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
}

// -----------------------------------------------------------------------------
// Availability & Rate Explicit Endpoints
// -----------------------------------------------------------------------------
async function confirmAvailability(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const { availability } = req.body;

    const updated = await prismService.confirmAvailability(submissionId, userId, { availability });
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
}

async function confirmRate(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const { rate, rateType, rate_type, availability } = req.body;

    const finalRateType = rateType || rate_type;
    const updated = await prismService.confirmRate(submissionId, userId, {
      rate,
      rateType: finalRateType,
      availability,
    });
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
}

// -----------------------------------------------------------------------------
// RTR (Right to Represent)
// -----------------------------------------------------------------------------
async function createRTR(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const { status, documentUrl } = req.body;

    const rtr = await prismService.createRTR({
      submissionId,
      status,
      documentUrl,
      userId,
    });

    res.status(201).json({ data: rtr });
  } catch (err) {
    next(err);
  }
}

async function getRTRBySubmissionId(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;

    const rtr = await prismService.getRTRBySubmissionId(submissionId, userId);
    res.json({ data: rtr });
  } catch (err) {
    next(err);
  }
}

async function updateRTRStatus(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const { rtrId, status, documentUrl } = req.body;

    const updated = await prismService.updateRTRStatus(rtrId, submissionId, status, userId, documentUrl);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
}

// -----------------------------------------------------------------------------
// Interview & Final Validation Endpoints
// -----------------------------------------------------------------------------
async function scheduleInterview(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const { scheduledAt, interviewType, round, meetingLink, notes, interviewers } = req.body;

    const updated = await prismService.scheduleInterview(submissionId, userId, {
      scheduledAt,
      interviewType,
      round,
      meetingLink,
      notes,
      interviewers,
    });
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
}

async function runFinalValidation(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;

    const updated = await prismService.runFinalValidation(submissionId, userId);
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
}

async function submitFinalSubmission(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;

    const updated = await prismService.submitFinalSubmission(submissionId, userId);
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
}

// -----------------------------------------------------------------------------
// Audit History
// -----------------------------------------------------------------------------
async function getAuditHistory(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;

    const auditLogs = await prismService.getAuditHistory(submissionId, userId);
    res.json({ data: auditLogs });
  } catch (err) {
    next(err);
  }
}

// -----------------------------------------------------------------------------
// Consents (Legacy API Compatibility)
// -----------------------------------------------------------------------------
async function createConsent(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const { status, notes } = req.body;

    const consent = await prismService.createConsent({
      submissionId,
      status,
      notes,
      userId,
    });

    res.status(201).json({ data: consent });
  } catch (err) {
    next(err);
  }
}

async function getConsentBySubmissionId(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;

    const consent = await prismService.getConsentBySubmissionId(submissionId, userId);
    res.json({ data: consent });
  } catch (err) {
    next(err);
  }
}

async function updateConsentStatus(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const { consentId, status, notes } = req.body;

    const updated = await prismService.updateConsentStatus(consentId, submissionId, status, userId, notes);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
}

// -----------------------------------------------------------------------------
// Approvals (Legacy API Compatibility)
// -----------------------------------------------------------------------------
async function createApproval(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const { status, notes } = req.body;

    const approval = await prismService.createApproval({
      submissionId,
      status,
      notes,
      userId,
    });

    res.status(201).json({ data: approval });
  } catch (err) {
    next(err);
  }
}

async function getApprovalBySubmissionId(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;

    const approval = await prismService.getApprovalBySubmissionId(submissionId, userId);
    res.json({ data: approval });
  } catch (err) {
    next(err);
  }
}

async function updateApprovalStatus(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const { approvalId, status, notes } = req.body;

    const updated = await prismService.updateApprovalStatus(approvalId, submissionId, status, userId, notes);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
}

// -----------------------------------------------------------------------------
// Recruiter Label
// -----------------------------------------------------------------------------
async function updateRecruiterLabel(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;
    const { label } = req.body;

    const updated = await prismService.updateRecruiterLabel(submissionId, label, userId);
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
}

// -----------------------------------------------------------------------------
// Delete Submission
// -----------------------------------------------------------------------------
async function deleteSubmission(req, res, next) {
  try {
    const userId = req.userId;
    const { submissionId } = req.params;

    const result = await prismService.deleteSubmission(submissionId, userId);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createSubmission,
  listSubmissions,
  getSubmissionById,
  getSubmissionStatus,
  updateSubmissionStatus,
  updateSubmissionRateAvailability,

  requestCandidateConsent,
  getConsentPreview,
  recordCandidateConsentResponse,
  validateCandidate,
  getMaskedProfile,
  maskCandidateDetails,
  sendToVendor,
  getVendorPreview,
  getConsultantConfirmationPreview,
  getVendorConfirmationPreview,
  sendConsultantConfirmation,
  sendVendorConfirmation,
  recordConsultantConfirmationResponse,
  recordVendorConfirmationResponse,
  recordVendorResponse,
  validateVendor,
  confirmAvailability,
  confirmRate,

  createRTR,
  getRTRBySubmissionId,
  updateRTRStatus,

  scheduleInterview,
  runFinalValidation,
  submitFinalSubmission,
  getAuditHistory,

  createConsent,
  getConsentBySubmissionId,
  updateConsentStatus,

  createApproval,
  getApprovalBySubmissionId,
  updateApprovalStatus,

  updateRecruiterLabel,
  deleteSubmission,
};
