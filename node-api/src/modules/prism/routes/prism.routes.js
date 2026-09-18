const { Router } = require("express");
const prismController = require("../controllers/prism.controller");

const router = Router();

// -----------------------------------------------------------------------------
// Submissions CRUD & Direct Protected Status
// -----------------------------------------------------------------------------
router.get("/", prismController.listSubmissions);
router.post("/", prismController.createSubmission);
router.get("/:submissionId", prismController.getSubmissionById);
router.get("/:submissionId/status", prismController.getSubmissionStatus);
router.patch("/:submissionId/status", prismController.updateSubmissionStatus);
router.patch("/:submissionId/rate-availability", prismController.updateSubmissionRateAvailability);
router.patch("/:submissionId/label", prismController.updateRecruiterLabel);
router.delete("/:submissionId", prismController.deleteSubmission);

// -----------------------------------------------------------------------------
// Candidate Workflow (Consent, Validation, Masking)
// -----------------------------------------------------------------------------
router.get("/:submissionId/consent/preview", prismController.getConsentPreview);
router.post("/:submissionId/consent", prismController.requestCandidateConsent);
router.patch("/:submissionId/consent/response", prismController.recordCandidateConsentResponse);
router.post("/:submissionId/validate-candidate", prismController.validateCandidate);
router.get("/:submissionId/masked-profile", prismController.getMaskedProfile);
router.post("/:submissionId/mask", prismController.maskCandidateDetails);

// -----------------------------------------------------------------------------
// Vendor Workflow (Send to Vendor, Vendor Response, Vendor Validation)
// -----------------------------------------------------------------------------
router.get("/:submissionId/vendor/preview", prismController.getVendorPreview);
router.post("/:submissionId/send-vendor", prismController.sendToVendor);
router.patch("/:submissionId/vendor-response", prismController.recordVendorResponse);
router.post("/:submissionId/validate-vendor", prismController.validateVendor);

// -----------------------------------------------------------------------------
// Availability & Rate Explicit Steps & Both-Party Confirmations
// -----------------------------------------------------------------------------
router.patch("/:submissionId/availability", prismController.confirmAvailability);
router.patch("/:submissionId/rate", prismController.confirmRate);

router.get("/:submissionId/confirmation/consultant/preview", prismController.getConsultantConfirmationPreview);
router.get("/:submissionId/confirmation/vendor/preview", prismController.getVendorConfirmationPreview);
router.post("/:submissionId/confirmation/consultant/send", prismController.sendConsultantConfirmation);
router.post("/:submissionId/confirmation/vendor/send", prismController.sendVendorConfirmation);
router.patch("/:submissionId/confirmation/consultant/response", prismController.recordConsultantConfirmationResponse);
router.patch("/:submissionId/confirmation/vendor/response", prismController.recordVendorConfirmationResponse);

// -----------------------------------------------------------------------------
// RTR (Right to Represent)
// -----------------------------------------------------------------------------
router.get("/:submissionId/rtr", prismController.getRTRBySubmissionId);
router.post("/:submissionId/rtr", prismController.createRTR);
router.patch("/:submissionId/rtr/status", prismController.updateRTRStatus);
router.patch("/:submissionId/rtr", prismController.updateRTRStatus);

// -----------------------------------------------------------------------------
// Interview, Final Validation & Submission
// -----------------------------------------------------------------------------
router.post("/:submissionId/interview", prismController.scheduleInterview);
router.post("/:submissionId/final-validate", prismController.runFinalValidation);
router.post("/:submissionId/submit", prismController.submitFinalSubmission);

// -----------------------------------------------------------------------------
// Audit Log History
// -----------------------------------------------------------------------------
router.get("/:submissionId/audit", prismController.getAuditHistory);

// -----------------------------------------------------------------------------
// Consents & Approvals (Legacy Compatibility)
// -----------------------------------------------------------------------------
router.get("/:submissionId/consent", prismController.getConsentBySubmissionId);
router.patch("/:submissionId/consent", prismController.updateConsentStatus);

router.get("/:submissionId/approval", prismController.getApprovalBySubmissionId);
router.post("/:submissionId/approval", prismController.createApproval);
router.patch("/:submissionId/approval", prismController.updateApprovalStatus);

module.exports = router;
