const { pool } = require("../../../config/db");
const prismRepo = require("../repositories/prism.repository");
const candidateRepo = require("../../../repositories/candidate.repository");
const jobRepo = require("../../../repositories/job.repository");
const vendorRepo = require("../repositories/vendor.repository");
const resumeRepo = require("../../../repositories/resume.repository");
const env = require("../../../config/env");
const log = require("../../../utils/logger");
const platformEvents = require("../../../services/platformEvents.service");

// -----------------------------------------------------------------------------
// 1. Authoritative Workflow Statuses
// -----------------------------------------------------------------------------
const WORKFLOW_STATUSES = {
  DRAFT: "DRAFT",
  PENDING_CONSENT: "PENDING_CONSENT",
  CONSENT_REJECTED: "CONSENT_REJECTED",
  CANDIDATE_VALIDATED: "CANDIDATE_VALIDATED",
  MASKED: "MASKED",
  VENDOR_SUBMITTED: "VENDOR_SUBMITTED",
  VENDOR_ACCEPTED: "VENDOR_ACCEPTED",
  VENDOR_VALIDATED: "VENDOR_VALIDATED",
  AVAILABILITY_CONFIRMED: "AVAILABILITY_CONFIRMED",
  RATE_CONFIRMED: "RATE_CONFIRMED",
  PENDING_RTR: "PENDING_RTR",
  RTR_CONFIRMED: "RTR_CONFIRMED",
  INTERVIEW_SCHEDULED: "INTERVIEW_SCHEDULED",
  READY: "READY",
  SUBMITTED: "SUBMITTED",
  REJECTED: "REJECTED",
  WITHDRAWN: "WITHDRAWN",
};

const VALID_STATUSES = Object.values(WORKFLOW_STATUSES);

// -----------------------------------------------------------------------------
// 2. Authoritative Transition Matrix
// -----------------------------------------------------------------------------
const TRANSITIONS = {
  DRAFT: [WORKFLOW_STATUSES.PENDING_CONSENT, WORKFLOW_STATUSES.WITHDRAWN],
  PENDING_CONSENT: [
    WORKFLOW_STATUSES.CANDIDATE_VALIDATED,
    WORKFLOW_STATUSES.CONSENT_REJECTED,
    WORKFLOW_STATUSES.WITHDRAWN,
  ],
  CONSENT_REJECTED: [WORKFLOW_STATUSES.WITHDRAWN],
  CANDIDATE_VALIDATED: [WORKFLOW_STATUSES.MASKED, WORKFLOW_STATUSES.WITHDRAWN],
  MASKED: [WORKFLOW_STATUSES.VENDOR_SUBMITTED, WORKFLOW_STATUSES.WITHDRAWN],
  VENDOR_SUBMITTED: [
    WORKFLOW_STATUSES.VENDOR_ACCEPTED,
    WORKFLOW_STATUSES.REJECTED,
    WORKFLOW_STATUSES.WITHDRAWN,
  ],
  VENDOR_ACCEPTED: [
    WORKFLOW_STATUSES.VENDOR_VALIDATED,
    WORKFLOW_STATUSES.WITHDRAWN,
  ],
  VENDOR_VALIDATED: [
    WORKFLOW_STATUSES.AVAILABILITY_CONFIRMED,
    WORKFLOW_STATUSES.WITHDRAWN,
  ],
  AVAILABILITY_CONFIRMED: [
    WORKFLOW_STATUSES.RATE_CONFIRMED,
    WORKFLOW_STATUSES.WITHDRAWN,
  ],
  RATE_CONFIRMED: [
    WORKFLOW_STATUSES.PENDING_RTR,
    WORKFLOW_STATUSES.WITHDRAWN,
  ],
  PENDING_RTR: [
    WORKFLOW_STATUSES.RTR_CONFIRMED,
    WORKFLOW_STATUSES.REJECTED,
    WORKFLOW_STATUSES.WITHDRAWN,
  ],
  RTR_CONFIRMED: [
    WORKFLOW_STATUSES.INTERVIEW_SCHEDULED,
    WORKFLOW_STATUSES.WITHDRAWN,
  ],
  INTERVIEW_SCHEDULED: [
    WORKFLOW_STATUSES.READY,
    WORKFLOW_STATUSES.WITHDRAWN,
  ],
  READY: [
    WORKFLOW_STATUSES.SUBMITTED,
    WORKFLOW_STATUSES.WITHDRAWN,
  ],
  SUBMITTED: [WORKFLOW_STATUSES.WITHDRAWN],
  REJECTED: [],
  WITHDRAWN: [],
};

function createWorkflowError(message, statusCode = 400, code = "INVALID_WORKFLOW_TRANSITION", details = null) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  if (details) err.details = details;
  return err;
}

// -----------------------------------------------------------------------------
// 3. Real Validation Gates
// -----------------------------------------------------------------------------

/**
 * Real Candidate Validation Gate
 * Checks candidate profile completeness, resume validity, job eligibility, consent status, and duplicate check.
 */
async function runCandidateValidation(client, submission, userId) {
  const candidate = await candidateRepo.getCandidateWithCurrentResume(client, submission.candidate_id, userId);
  if (!candidate) {
    return {
      status: "FAILED",
      checks: { candidateExists: false },
      failureReasons: ["Candidate not found or unauthorized."],
      validatedAt: new Date().toISOString(),
      validatedBy: userId,
    };
  }

  const resume = await resumeRepo.getResumeById(client, submission.resume_id);
  const job = await jobRepo.getJobById(client, submission.job_id, userId);
  const consent = await prismRepo.getLatestConsent(client, submission.id, userId);
  const duplicate = await prismRepo.findActiveDuplicateSubmission(
    client,
    submission.candidate_id,
    submission.job_id,
    userId,
    submission.id
  );

  const checks = {
    candidateCompleteness: Boolean(candidate.full_name && (candidate.email || candidate.phone)),
    resumeValid: Boolean(resume && (resume.raw_text || resume.resume_summary)),
    jobEligibility: Boolean(job && job.title),
    consentApproved: Boolean(consent && consent.status === "APPROVED"),
    duplicateCheck: !duplicate,
  };

  const failureReasons = [];
  if (!checks.candidateCompleteness) failureReasons.push("Candidate profile is incomplete (missing name or contact).");
  if (!checks.resumeValid) failureReasons.push("Candidate resume contains no readable text or summary.");
  if (!checks.jobEligibility) failureReasons.push("Target job is invalid or missing.");
  if (!checks.consentApproved) failureReasons.push("Candidate consent has not been approved.");
  if (!checks.duplicateCheck) failureReasons.push("An active submission already exists for this candidate and job.");

  const isPassed = failureReasons.length === 0;

  return {
    status: isPassed ? "PASSED" : "FAILED",
    checks,
    failureReasons,
    validatedAt: new Date().toISOString(),
    validatedBy: userId,
  };
}

/**
 * Generate Real Vendor-Safe Masked Profile
 * Sanitizes candidate PII while preserving skills, experience, and qualification summary.
 */
function buildMaskedProfile(candidate, resume, job) {
  const candidateIdShort = candidate.id ? candidate.id.slice(0, 8).toUpperCase() : "REF";
  const initials = candidate.full_name
    ? candidate.full_name.split(" ").map((n) => n[0]).join("").toUpperCase()
    : "CD";

  return {
    maskedCandidateId: `CAN-${candidateIdShort}`,
    displayName: `Candidate ${initials} (${candidate.primary_role || resume?.primary_role || "Specialist"})`,
    primaryRole: candidate.primary_role || resume?.primary_role || "Candidate",
    totalExperience: candidate.total_experience != null ? `${candidate.total_experience} Years` : (resume?.total_experience != null ? `${resume.total_experience} Years` : "Experienced"),
    immigrationStatus: candidate.immigration_status || "Verified / Authorized",
    generalLocation: candidate.location ? candidate.location.split(",").slice(-2).join(",").trim() : "US / Remote",
    skills: resume?.skills || candidate.skills || [],
    profileSummary: resume?.resume_summary || resume?.profile_summary || "Candidate matched with requirement.",
    jobTitle: job?.title || "Target Position",
    email: "[PROTECTED / VIA RECRUITER]",
    phone: "[PROTECTED]",
    maskedAt: new Date().toISOString(),
  };
}


/**
 * Real Vendor Validation Gate
 * Checks vendor existence, ownership, active status, and association with the job.
 */
async function runVendorValidation(client, submission, userId) {
  const job = await jobRepo.getJobById(client, submission.job_id, userId);
  const vendor = await resolveVendorForJob(client, job, userId);
  if (!vendor) {
    return {
      status: "FAILED",
      checks: { jobLinkedToVendor: false, vendorExists: false },
      failureReasons: ["Job does not have an associated Vendor."],
      validatedAt: new Date().toISOString(),
      validatedBy: userId,
    };
  }

  // Persist vendor link to job if not already set
  if (job && !job.vendor_id && vendor.id) {
    await client.query("UPDATE core.requirements SET vendor_id = $1 WHERE id = $2", [vendor.id, job.id]);
    job.vendor_id = vendor.id;
  }

  const checks = {
    vendorExists: true,
    vendorActive: vendor.status === "ACTIVE" || vendor.status === "PENDING",
    jobLinkedToVendor: true,
    vendorOwnership: vendor.created_by === userId || vendor.created_by == null,
  };

  const failureReasons = [];
  if (!checks.vendorActive) failureReasons.push(`Vendor status is '${vendor.status}', must be 'ACTIVE' or 'PENDING'.`);
  if (!checks.vendorOwnership) failureReasons.push("Vendor does not belong to your organization.");

  const isPassed = failureReasons.length === 0;

  return {
    status: isPassed ? "PASSED" : "FAILED",
    checks,
    vendorId: vendor.id,
    vendorName: vendor.name,
    vendorStatus: vendor.status,
    failureReasons,
    validatedAt: new Date().toISOString(),
    validatedBy: userId,
  };
}

/**
 * Real Final Gate Validation
 * Evaluates all 10 workflow gates to ensure audit readiness.
 */
async function runFinalValidation(client, submission, userId) {
  const gates = {};
  const failureReasons = [];

  // 1. Candidate Consent Gate
  const consent = await prismRepo.getLatestConsent(client, submission.id, userId);
  gates.consentApproved = Boolean(consent && consent.status === "APPROVED");
  if (!gates.consentApproved) failureReasons.push("Candidate consent must be APPROVED.");

  // 2. Candidate Validation Gate
  const candValidation = submission.candidate_validation_results || {};
  gates.candidateValidated = candValidation.status === "PASSED";
  if (!gates.candidateValidated) failureReasons.push("Candidate validation must be PASSED.");

  // 3. Masking Gate
  const masked = submission.masked_profile || {};
  gates.candidateMasked = Boolean(masked.maskedCandidateId && masked.maskedCandidateId.length > 0);
  if (!gates.candidateMasked) failureReasons.push("Candidate profile must be MASKED.");

  // 4. Vendor Existence & Active Gate
  const job = await jobRepo.getJobById(client, submission.job_id, userId);
  const vendor = await resolveVendorForJob(client, job, userId);
  if (!vendor) {
    gates.vendorLinked = false;
    gates.vendorActive = false;
    failureReasons.push("Job must have an associated Vendor.");
  } else {
    gates.vendorLinked = true;
    gates.vendorActive = vendor.status === "ACTIVE" || vendor.status === "PENDING";
    if (!gates.vendorActive) failureReasons.push("Associated Vendor must be ACTIVE or PENDING.");
    if (job && !job.vendor_id && vendor.id) {
      await client.query("UPDATE core.requirements SET vendor_id = $1 WHERE id = $2", [vendor.id, job.id]);
      job.vendor_id = vendor.id;
    }
  }

  // 5. Vendor Validation Gate
  const vendValidation = submission.vendor_validation_results || {};
  gates.vendorValidated = vendValidation.status === "PASSED";
  if (!gates.vendorValidated) failureReasons.push("Vendor validation must be PASSED.");

  // 6. Availability Gate
  gates.availabilityConfirmed = Boolean(submission.availability && submission.availability.trim().length > 0);
  if (!gates.availabilityConfirmed) failureReasons.push("Candidate availability must be CONFIRMED.");

  // 7. Rate & Rate Type Gate
  const rateNum = Number(submission.rate);
  const validRateTypes = ["HOURLY", "DAILY", "ANNUAL", "C2C", "W2"];
  gates.rateConfirmed = !isNaN(rateNum) && rateNum > 0 && Boolean(submission.rate_type && validRateTypes.includes(submission.rate_type.toUpperCase()));
  if (!gates.rateConfirmed) failureReasons.push("Rate (positive number) and valid Rate Type must be CONFIRMED.");

  // 8. RTR Gate
  const rtr = await prismRepo.getRTRBySubmissionId(client, submission.id, userId);
  gates.rtrConfirmed = Boolean(rtr && rtr.status === "SIGNED");
  if (!gates.rtrConfirmed) failureReasons.push("Right to Represent (RTR) must be SIGNED.");

  // 9. Interview Scheduled Gate
  const interview = submission.interview_details || {};
  gates.interviewScheduled = Boolean(interview.scheduledAt);
  if (!gates.interviewScheduled) failureReasons.push("Interview details must be SCHEDULED.");

  // 10. Duplicate Check Gate
  const duplicate = await prismRepo.findActiveDuplicateSubmission(
    client,
    submission.candidate_id,
    submission.job_id,
    userId,
    submission.id
  );
  gates.duplicateCheckPassed = !duplicate;
  if (!gates.duplicateCheckPassed) failureReasons.push("Duplicate active submission detected.");

  const isPassed = failureReasons.length === 0;

  return {
    status: isPassed ? "PASSED" : "FAILED",
    gates,
    failureReasons,
    validatedAt: new Date().toISOString(),
    validatedBy: userId,
  };
}

// -----------------------------------------------------------------------------
// 4. Central State Transition Executor
// -----------------------------------------------------------------------------

/**
 * Execute State Transition Transaction
 * Atomically locks row, validates state machine transition, checks gates, updates status/workflow data, logs audit.
 */
async function executeTransition(submissionId, userId, targetStatus, updateData = {}, gateCheckFn = null) {
  if (!VALID_STATUSES.includes(targetStatus)) {
    throw createWorkflowError(`Invalid status '${targetStatus}'.`, 400);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Lock submission row for update to prevent race conditions
    const submission = await prismRepo.getSubmissionForUpdate(client, submissionId, userId);
    if (!submission) {
      throw createWorkflowError("Submission not found or unauthorized.", 404);
    }

    const currentStatus = submission.status;

    // Idempotent check: if already in target status, return existing submission cleanly
    if (currentStatus === targetStatus) {
      await client.query("COMMIT");
      return submission;
    }

    // 2. Terminal state check
    if (["REJECTED", "WITHDRAWN"].includes(currentStatus) && targetStatus !== "WITHDRAWN") {
      throw createWorkflowError(
        `Cannot transition from terminal status '${currentStatus}' to '${targetStatus}'.`,
        400
      );
    }

    // 3. Verify Allowed Transitions
    const allowed = TRANSITIONS[currentStatus] || [];
    const isTerminalWithdrawal = ["REJECTED", "WITHDRAWN"].includes(currentStatus) && targetStatus === "WITHDRAWN";
    if (!allowed.includes(targetStatus) && !isTerminalWithdrawal) {
      throw createWorkflowError(
        `Submission cannot transition from ${currentStatus} to ${targetStatus}.`,
        400,
        "INVALID_WORKFLOW_TRANSITION",
        { currentStatus, targetStatus, allowedTransitions: allowed }
      );
    }

    // 4. Run gate validation if provided
    if (gateCheckFn) {
      await gateCheckFn(client, submission);
    }

    // 5. Update submission workflow data & status
    const updated = await prismRepo.updateSubmissionWorkflowData(client, submissionId, userId, {
      ...updateData,
      status: targetStatus,
    });

    // 6. Insert audit log
    await prismRepo.insertAuditLog(client, {
      entityType: "SUBMISSION",
      entityId: submissionId,
      previousStatus: currentStatus,
      newStatus: targetStatus,
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
// 5. Workflow Action Methods
// -----------------------------------------------------------------------------

/**
 * Step 1: Initiate Candidate Consent Request or Controlled Resend
 * Transitions DRAFT -> PENDING_CONSENT on initial send.
 * Remains PENDING_CONSENT and increments resend count on eligible resend.
 */
async function requestCandidateConsent(submissionId, userId, { notes, channel = "MANUAL", contractType } = {}) {
  const maxResends = env.CONSENT_MAX_RESENDS || 3;
  const cooldownMinutes = env.CONSENT_RESEND_COOLDOWN_MINUTES || 60;
  const now = new Date();

  let isInitialSend = false;
  let prevLastSentAt = null;
  let prevResendCount = 0;
  let targetJobId = null;
  let candidateData = null;
  let jobData = null;

  // Phase 1: Fast Atomic Transaction (< 2ms) to claim state and enforce concurrency lock
  const client1 = await pool.connect();
  try {
    await client1.query("BEGIN");

    const sub = await prismRepo.getSubmissionForUpdate(client1, submissionId, userId);
    if (!sub) {
      throw createWorkflowError("Submission not found or unauthorized.", 404);
    }

    targetJobId = sub.job_id;
    prevLastSentAt = sub.last_consent_sent_at || null;
    prevResendCount = Number(sub.consent_resend_count || 0);

    const candidate = await candidateRepo.getCandidateWithCurrentResume(client1, sub.candidate_id, userId);
    if (!candidate || !candidate.email) {
      throw createWorkflowError("Candidate does not have a valid email address.", 400);
    }
    candidateData = candidate;

    if (targetJobId) {
      jobData = await jobRepo.getJobById(client1, targetJobId, userId);
    }

    if (sub.status === WORKFLOW_STATUSES.DRAFT) {
      isInitialSend = true;
      await prismRepo.updateSubmissionWorkflowData(client1, submissionId, userId, {
        status: WORKFLOW_STATUSES.PENDING_CONSENT,
        lastConsentSentAt: now,
        consentResendCount: 0,
      });

      const existingConsent = await prismRepo.getLatestConsent(client1, submissionId, userId);
      if (existingConsent) {
        await prismRepo.updateConsentStatus(client1, existingConsent.id, submissionId, userId, "REQUESTED", notes);
      } else {
        await prismRepo.createConsent(client1, {
          submissionId,
          status: "REQUESTED",
          notes,
          createdBy: userId,
        });
      }

      await prismRepo.insertAuditLog(client1, {
        entityType: "SUBMISSION",
        entityId: submissionId,
        previousStatus: WORKFLOW_STATUSES.DRAFT,
        newStatus: WORKFLOW_STATUSES.PENDING_CONSENT,
        createdBy: userId,
      });

    } else if (sub.status === WORKFLOW_STATUSES.PENDING_CONSENT) {
      isInitialSend = false;
      const consent = await prismRepo.getLatestConsent(client1, submissionId, userId);
      if (!consent || consent.status !== "REQUESTED") {
        throw createWorkflowError("Candidate has already responded to consent request.", 400, "CONSENT_ALREADY_DECIDED");
      }

      if (prevResendCount >= maxResends) {
        throw createWorkflowError("Maximum consent resend limit has been reached.", 400, "CONSENT_RESEND_LIMIT_REACHED", {
          resendCount: prevResendCount,
          maxResends,
        });
      }

      if (prevLastSentAt) {
        const lastSent = new Date(prevLastSentAt);
        const cooldownMs = cooldownMinutes * 60 * 1000;
        const nextResendAt = new Date(lastSent.getTime() + cooldownMs);
        const remainingMs = nextResendAt.getTime() - now.getTime();
        if (remainingMs > 0) {
          const remainingSeconds = Math.ceil(remainingMs / 1000);
          throw createWorkflowError("Consent email can be resent after the cooldown period.", 400, "CONSENT_RESEND_COOLDOWN", {
            nextResendAt: nextResendAt.toISOString(),
            remainingSeconds,
          });
        }
      }

      const newResendCount = prevResendCount + 1;
      await prismRepo.updateSubmissionWorkflowData(client1, submissionId, userId, {
        lastConsentSentAt: now,
        consentResendCount: newResendCount,
      });

      await prismRepo.insertAuditLog(client1, {
        entityType: "SUBMISSION",
        entityId: submissionId,
        previousStatus: WORKFLOW_STATUSES.PENDING_CONSENT,
        newStatus: "CONSENT_RESENT",
        createdBy: userId,
      });

    } else {
      log.warn(`[CONSENT] resend blocked submission=${submissionId} state=${sub.status}`);
      throw createWorkflowError(`Cannot request or resend consent for submission in '${sub.status}' state.`, 400);
    }

    await client1.query("COMMIT");
  } catch (err) {
    await client1.query("ROLLBACK");
    throw err;
  } finally {
    client1.release();
  }

  // Phase 2: External Network Call to RELAY / Gmail API (OUTSIDE DB Transaction)
  // Build canonical consent subject & body from single source of truth
  const { buildCanonicalConsentEmail } = require("../utils/consentEmailTemplate");
  const canonical = buildCanonicalConsentEmail({
    candidateName: candidateData.full_name || candidateData.fullName,
    jobTitle: jobData?.title,
    location: jobData?.location,
    contractType: contractType || jobData?.employment_type || "C2C",
    immigrationStatus: candidateData.immigration_status || candidateData.immigrationStatus,
    requiredSkills: jobData?.required_skills,
  });

  try {
    const relayAdapter = require("../../../services/relay.adapter");
    await relayAdapter.sendCandidateConsentEmail({
      jobId: targetJobId,
      submissionId: submissionId,
      candidate: candidateData,
      subject: canonical.subject,
      body: canonical.body,
    });
  } catch (err) {
    // If network call fails, revert DB state back in a fast transaction
    const clientRevert = await pool.connect();
    try {
      await clientRevert.query("BEGIN");
      if (isInitialSend) {
        // Keep PENDING_CONSENT so an inbound YES can still attach even if Gmail/Relay failed.
        log.warn(`[CONSENT] outbound email failed; leaving submission ${submissionId} in PENDING_CONSENT`);
      } else {
        await prismRepo.updateSubmissionWorkflowData(clientRevert, submissionId, userId, {
          lastConsentSentAt: prevLastSentAt,
          consentResendCount: prevResendCount,
        });
      }
      await clientRevert.query("COMMIT");
    } catch {
      await clientRevert.query("ROLLBACK");
    } finally {
      clientRevert.release();
    }
    throw err;
  }

  return await prismRepo.getRawSubmissionById(null, submissionId, userId);
}

/**
 * Resolves the appropriate vendor for a Job in a deterministic, tenant-isolated manner.
 * Hierarchy:
 * 1. Explicit Assigned Vendor: If job.vendor_id is set and owned by userId, return that vendor.
 * 2. Source Email Match: If job.source_email matches a vendor's email owned by userId, return that vendor.
 * 3. Skill & Location Alignment: If vendor.preferred_technologies matches job.required_skills or job.location matches vendor.location.
 * 4. Deterministic Recruiter Default: Earliest created eligible vendor owned by userId with a valid email.
 * @param {object} client - pg pool client
 * @param {object} job - core.requirements row (as job.repository returns it)
 * @param {string} userId - Recruiter user ID
 * @returns {Promise<object|null>} Resolved vendor object or null
 */
async function resolveVendorForJob(client, job, userId) {
  if (!job || !userId) return null;

  // 1. Explicit Assigned Vendor
  if (job.vendor_id) {
    const explicitVendor = await vendorRepo.getVendorById(client, job.vendor_id, userId);
    if (explicitVendor && (explicitVendor.status === "ACTIVE" || explicitVendor.status === "PENDING")) {
      const email = explicitVendor.primary_email || explicitVendor.contact_email || explicitVendor.email;
      if (email) {
        log.info(`[resolveVendorForJob] Selected explicitly assigned vendor: ${explicitVendor.name} (${explicitVendor.id})`);
        return explicitVendor;
      }
    }
  }

  // Fetch all vendors owned by this recruiter
  const vendors = await vendorRepo.listVendors(userId, {}, client);
  const eligibleVendors = (vendors || []).filter(
    (v) => (v.status === "ACTIVE" || v.status === "PENDING") && (v.primary_email || v.contact_email || v.email)
  );

  if (eligibleVendors.length === 0) {
    log.warn(`[resolveVendorForJob] No eligible vendors with contact email found for recruiter ${userId}`);
    return null;
  }

  // 2. Match by Job Source Email (if JD came from vendor email)
  if (job.source_email) {
    const cleanSourceEmail = job.source_email.toLowerCase().trim();
    const emailMatch = eligibleVendors.find((v) => {
      const vEmail = (v.primary_email || v.contact_email || v.email || "").toLowerCase().trim();
      return vEmail === cleanSourceEmail;
    });
    if (emailMatch) {
      log.info(`[resolveVendorForJob] Selected vendor by source_email match (${cleanSourceEmail}): ${emailMatch.name} (${emailMatch.id})`);
      return emailMatch;
    }
  }

  // 3. Match by Technology / Location Alignment
  const jobSkills = Array.isArray(job.required_skills) ? job.required_skills.map((s) => String(s).toLowerCase()) : [];
  const jobTitle = String(job.title || "").toLowerCase();
  const jobLocation = String(job.location || "").toLowerCase();

  for (const v of eligibleVendors) {
    const vTech = String(v.preferred_technologies || "").toLowerCase();
    const vLoc = String(v.location || "").toLowerCase();

    const techMatch = vTech && (jobSkills.some((s) => s.includes(vTech) || vTech.includes(s)) || jobTitle.includes(vTech));
    const locMatch = vLoc && jobLocation && (jobLocation.includes(vLoc) || vLoc.includes(jobLocation));

    if (techMatch || locMatch) {
      log.info(`[resolveVendorForJob] Selected vendor by tech/location match (tech=${Boolean(techMatch)}, loc=${Boolean(locMatch)}): ${v.name} (${v.id})`);
      return v;
    }
  }

  // 4. Deterministic Recruiter Default: Earliest created eligible vendor
  const sorted = [...eligibleVendors].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const defaultVendor = sorted[0];
  log.info(`[resolveVendorForJob] Selected deterministic default vendor: ${defaultVendor.name} (${defaultVendor.id})`);
  return defaultVendor;
}

/**
 * Step 2: Record Candidate Consent Response
 * If YES/APPROVED: Runs Candidate Validation -> Transitions to CANDIDATE_VALIDATED if passed.
 * If NO/REJECTED: Transitions to CONSENT_REJECTED (Stop/Follow-up).
 */
async function recordCandidateConsentResponse(submissionId, userId, { response, notes } = {}) {
  const normalizedResponse = (response || "").toUpperCase();
  const isAccepted = ["YES", "APPROVED", "ACCEPTED"].includes(normalizedResponse);
  const isRejected = ["NO", "REJECTED", "DECLINED"].includes(normalizedResponse);

  if (!isAccepted && !isRejected) {
    throw createWorkflowError("Response must be 'ACCEPTED' or 'REJECTED'.", 400);
  }

  // Idempotency check: return cleanly if duplicate callback on already-processed submission
  const clientCheck = await pool.connect();
  let currentSub = null;
  try {
    currentSub = await prismRepo.getRawSubmissionById(clientCheck, submissionId, userId);
  } finally {
    clientCheck.release();
  }

  if (!currentSub) {
    throw createWorkflowError("Submission not found or unauthorized.", 404);
  }

  if (currentSub.status === WORKFLOW_STATUSES.DRAFT) {
    log.info(`[PRISM] Promoting DRAFT submission ${submissionId} to PENDING_CONSENT before recording consent response`);
    await executeTransition(submissionId, userId, WORKFLOW_STATUSES.PENDING_CONSENT);
    currentSub = { ...currentSub, status: WORKFLOW_STATUSES.PENDING_CONSENT };
  }

  if (isRejected && currentSub.status === WORKFLOW_STATUSES.CONSENT_REJECTED) {
    log.info(`[PRISM] Submission ${submissionId} already in CONSENT_REJECTED state. Idempotent return.`);
    return await prismRepo.getSubmissionById(submissionId, userId);
  }

  if (
    isAccepted &&
    [
      WORKFLOW_STATUSES.CANDIDATE_VALIDATED,
      WORKFLOW_STATUSES.MASKED,
      WORKFLOW_STATUSES.VENDOR_SUBMITTED,
      WORKFLOW_STATUSES.VENDOR_ACCEPTED,
    ].includes(currentSub.status)
  ) {
    log.info(
      `[PRISM] Submission ${submissionId} already processed candidate consent (state: ${currentSub.status}). Idempotent return.`
    );
    return await prismRepo.getSubmissionById(submissionId, userId);
  }

  if (isRejected) {
    return await executeTransition(
      submissionId,
      userId,
      WORKFLOW_STATUSES.CONSENT_REJECTED,
      {},
      async (client, sub) => {
        const consent = await prismRepo.getLatestConsent(client, sub.id, userId);
        if (consent) {
          await prismRepo.updateConsentStatus(client, consent.id, sub.id, userId, "REJECTED", notes);
        } else {
          await prismRepo.createConsent(client, {
            submissionId: sub.id,
            status: "REJECTED",
            notes,
            createdBy: userId,
          });
        }
      }
    );
  }

  // Accepted -> Record Consent APPROVED, run Candidate Validation, transition to CANDIDATE_VALIDATED
  let validationResult = null;
  const validatedSub = await executeTransition(
    submissionId,
    userId,
    WORKFLOW_STATUSES.CANDIDATE_VALIDATED,
    {},
    async (client, sub) => {
      const consent = await prismRepo.getLatestConsent(client, sub.id, userId);
      if (consent) {
        await prismRepo.updateConsentStatus(client, consent.id, sub.id, userId, "APPROVED", notes);
      } else {
        await prismRepo.createConsent(client, {
          submissionId: sub.id,
          status: "APPROVED",
          notes,
          createdBy: userId,
        });
      }

      validationResult = await runCandidateValidation(client, sub, userId);
      if (validationResult.status !== "PASSED") {
        throw createWorkflowError(
          `Candidate validation failed: ${validationResult.failureReasons.join(" ")}`,
          400,
          "CANDIDATE_VALIDATION_FAILED",
          validationResult
        );
      }

      // Save validation results
      sub.candidate_validation_results = validationResult;
      await prismRepo.updateSubmissionWorkflowData(client, sub.id, userId, {
        candidateValidationResults: validationResult,
      });
    }
  );

  log.info(`[PRISM] Candidate consent accepted & validation passed for submission ${submissionId}. Auto-continuing workflow...`);

  // AUTOMATIC CHAIN: MASKING -> VENDOR IDENTIFICATION -> VENDOR EMAIL -> VENDOR_SUBMITTED
  try {
    // Step A: Auto-Masking (CANDIDATE_VALIDATED -> MASKED)
    const maskedSub = await maskCandidateDetails(submissionId, userId);
    log.info(`[PRISM] Submission ${submissionId} automatically masked.`);

    // Step B: Auto-Vendor Identification from JD
    const clientVendor = await pool.connect();
    let jobWithVendor = null;
    let vendor = null;
    try {
      jobWithVendor = await jobRepo.getJobById(clientVendor, validatedSub.job_id, userId);
      vendor = await resolveVendorForJob(clientVendor, jobWithVendor, userId);
    } finally {
      clientVendor.release();
    }

    if (!vendor || !vendor.id) {
      log.warn(`[PRISM] Submission ${submissionId} masked, but no eligible vendor found for recruiter ${userId}. Awaiting vendor assignment.`);
      return maskedSub;
    }

    const vendorEmail = vendor.primary_email || vendor.contact_email || vendor.email;
    if (!vendorEmail) {
      log.warn(`[PRISM] Submission ${submissionId} masked, but vendor ${vendor.name} has no email address. Awaiting manual dispatch.`);
      return maskedSub;
    }

    // Step C: Auto-Dispatch Vendor Email via Relay
    const candidateProfile = maskedSub.masked_profile || {};
    const relayAdapter = require("../../../services/relay.adapter");
    await relayAdapter.sendCandidateProfileToVendor({
      jobId: jobWithVendor.id,
      submissionId: submissionId,
      candidateId: validatedSub.candidate_id,
      vendorEmail: vendorEmail,
      vendorName: vendor.name,
      jobTitle: jobWithVendor.title,
      maskedProfile: candidateProfile,
      rate: validatedSub.rate || jobWithVendor.rate,
      rateType: validatedSub.rate_type || jobWithVendor.rate_type,
      availability: validatedSub.availability,
    });

    // Step D: Mark VENDOR_SUBMITTED ONLY after successful Relay dispatch
    const submittedSub = await executeTransition(
      submissionId,
      userId,
      WORKFLOW_STATUSES.VENDOR_SUBMITTED
    );

    log.info(`[PRISM] Submission ${submissionId} automatically sent to vendor ${vendor.name} (${vendorEmail}) and marked VENDOR_SUBMITTED.`);
    return submittedSub;
  } catch (autoErr) {
    log.error(`[PRISM] Auto-continuation failed for submission ${submissionId}: ${autoErr.message}. Submission remains in current safe state.`);
    return await prismRepo.getSubmissionById(submissionId, userId);
  }
}

/**
 * Step 3: Run Candidate Validation explicitly
 */
async function validateCandidate(submissionId, userId) {
  const client = await pool.connect();
  try {
    const submission = await prismRepo.getRawSubmissionById(client, submissionId, userId);
    if (!submission) throw createWorkflowError("Submission not found or unauthorized.", 404);

    const validationResult = await runCandidateValidation(client, submission, userId);
    await prismRepo.updateSubmissionWorkflowData(client, submissionId, userId, {
      candidateValidationResults: validationResult,
    });

    if (submission.status === WORKFLOW_STATUSES.PENDING_CONSENT && validationResult.status === "PASSED") {
      // Transition to CANDIDATE_VALIDATED
      return await executeTransition(submissionId, userId, WORKFLOW_STATUSES.CANDIDATE_VALIDATED, {
        candidateValidationResults: validationResult,
      });
    }

    return {
      submissionId,
      validationResult,
    };
  } finally {
    client.release();
  }
}

/**
 * Step 4: Mask Candidate Details
 * Generates vendor-safe masked profile -> Transitions CANDIDATE_VALIDATED -> MASKED
 */
async function maskCandidateDetails(submissionId, userId, customMaskedData = null) {
  return await executeTransition(
    submissionId,
    userId,
    WORKFLOW_STATUSES.MASKED,
    {},
    async (client, sub) => {
      const candidate = await candidateRepo.getCandidateWithCurrentResume(client, sub.candidate_id, userId);
      const resume = await resumeRepo.getResumeById(client, sub.resume_id);
      const job = await jobRepo.getJobById(client, sub.job_id, userId);

      const maskedProfile = customMaskedData || buildMaskedProfile(candidate, resume, job);
      sub.masked_profile = maskedProfile;

      await prismRepo.updateSubmissionWorkflowData(client, sub.id, userId, {
        maskedProfile,
      });
    }
  );
}

/**
 * Step 5: Send Masked Profile to Vendor
 * Dispatches vendor email via RELAY and transitions MASKED -> VENDOR_SUBMITTED
 */
async function sendToVendor(submissionId, userId, options = {}) {
  // 1. Fetch submission, job, vendor, and ensure masked profile exists
  const clientCheck = await pool.connect();
  let job = null;
  let vendor = null;
  let sub = null;

  try {
    sub = await prismRepo.getRawSubmissionById(
      clientCheck,
      submissionId,
      userId
    );

    if (!sub) {
      throw createWorkflowError(
        "Submission not found or unauthorized.",
        404
      );
    }

    job = await jobRepo.getJobById(
      clientCheck,
      sub.job_id,
      userId
    );

    if (!job) {
      throw createWorkflowError(
        "Job record not found.",
        404
      );
    }

    vendor = await resolveVendorForJob(
      clientCheck,
      job,
      userId
    );

    if (!vendor) {
      throw createWorkflowError(
        "No eligible vendor found for this job.",
        400
      );
    }
  } finally {
    clientCheck.release();
  }

  const vendorEmail =
    vendor.primary_email ||
    vendor.contact_email ||
    vendor.email;

  if (!vendorEmail) {
    throw createWorkflowError(
      "Vendor has no registered contact email.",
      400
    );
  }

  // Ensure masked profile exists
  let maskedProfile = sub.masked_profile;

  if (!maskedProfile || !maskedProfile.maskedCandidateId) {
    const clientMask = await pool.connect();

    try {
      const candidate =
        await candidateRepo.getCandidateWithCurrentResume(
          clientMask,
          sub.candidate_id,
          userId
        );

      const resume = await resumeRepo.getResumeById(
        clientMask,
        sub.resume_id
      );

      maskedProfile = buildMaskedProfile(
        candidate,
        resume,
        job
      );

      await prismRepo.updateSubmissionWorkflowData(
        clientMask,
        sub.id,
        userId,
        { maskedProfile }
      );
    } finally {
      clientMask.release();
    }
  }

  // 2. Dispatch vendor email via Relay BEFORE updating status
  //    to VENDOR_SUBMITTED.
  const relayAdapter = require("../../../services/relay.adapter");

  await relayAdapter.sendCandidateProfileToVendor(
    {
      jobId: job.id,
      submissionId,
      candidateId: sub.candidate_id,
      vendorEmail,
      vendorName: vendor.name,
      jobTitle: job.title,
      maskedProfile,
      rate: sub.rate || job.rate,
      rateType: sub.rate_type || job.rate_type,
      availability: sub.availability,
    },
    options
  );

  // 3. Atomically transition to VENDOR_SUBMITTED.
  return await executeTransition(
    submissionId,
    userId,
    WORKFLOW_STATUSES.VENDOR_SUBMITTED,
    { maskedProfile }
  );
}

/**
 * Step 6: Record Vendor Response
 * If YES/ACCEPTED: Transitions to VENDOR_ACCEPTED
 * If NO/REJECTED: Transitions to REJECTED
 */
async function recordVendorResponse(submissionId, userId, { response, notes } = {}) {
  const normalized = (response || "").toUpperCase();
  const isAccepted = ["YES", "ACCEPTED", "APPROVED"].includes(normalized);
  const isRejected = ["NO", "REJECTED", "DECLINED"].includes(normalized);

  if (!isAccepted && !isRejected) {
    throw createWorkflowError("Vendor response must be 'ACCEPTED' or 'REJECTED'.", 400);
  }

  // Idempotency check: return cleanly if duplicate callback on already-processed submission
  const clientCheck = await pool.connect();
  let currentSub = null;
  try {
    currentSub = await prismRepo.getRawSubmissionById(clientCheck, submissionId, userId);
  } finally {
    clientCheck.release();
  }

  if (!currentSub) {
    throw createWorkflowError("Submission not found or unauthorized.", 404);
  }

  if (isAccepted && currentSub.status === WORKFLOW_STATUSES.VENDOR_ACCEPTED) {
    log.info(`[PRISM] Submission ${submissionId} already in VENDOR_ACCEPTED state. Idempotent return.`);
    return await prismRepo.getSubmissionById(submissionId, userId);
  }

  if (isRejected && currentSub.status === WORKFLOW_STATUSES.REJECTED) {
    log.info(`[PRISM] Submission ${submissionId} already in REJECTED state. Idempotent return.`);
    return await prismRepo.getSubmissionById(submissionId, userId);
  }

  if (isRejected) {
    return await executeTransition(submissionId, userId, WORKFLOW_STATUSES.REJECTED);
  }

  return await executeTransition(submissionId, userId, WORKFLOW_STATUSES.VENDOR_ACCEPTED);
}

/**
 * Step 7: Run Vendor Validation
 * Verifies vendor active, ownership, job association -> Transitions VENDOR_ACCEPTED -> VENDOR_VALIDATED
 */
async function validateVendor(submissionId, userId) {
  let validationResult = null;
  return await executeTransition(
    submissionId,
    userId,
    WORKFLOW_STATUSES.VENDOR_VALIDATED,
    {},
    async (client, sub) => {
      validationResult = await runVendorValidation(client, sub, userId);
      if (validationResult.status !== "PASSED") {
        throw createWorkflowError(
          `Vendor validation failed: ${validationResult.failureReasons.join(" ")}`,
          400,
          "VENDOR_VALIDATION_FAILED",
          validationResult
        );
      }
      await prismRepo.updateSubmissionWorkflowData(client, sub.id, userId, {
        vendorValidationResults: validationResult,
      });
    }
  );
}

/**
 * Step 8: Confirm Availability
 * Transitions VENDOR_VALIDATED -> AVAILABILITY_CONFIRMED
 */
async function confirmAvailability(submissionId, userId, { availability }) {
  if (!availability || typeof availability !== "string" || availability.trim() === "") {
    throw createWorkflowError("Availability must be a valid non-empty string.", 400);
  }

  return await executeTransition(
    submissionId,
    userId,
    WORKFLOW_STATUSES.AVAILABILITY_CONFIRMED,
    { availability: availability.trim() }
  );
}

/**
 * Step 9: Confirm Rate & Rate Type
 * Transitions AVAILABILITY_CONFIRMED -> RATE_CONFIRMED
 */
async function confirmRate(submissionId, userId, { rate, rateType, availability }) {
  const rateNum = Number(rate);
  if (isNaN(rateNum) || rateNum <= 0) {
    throw createWorkflowError("Rate must be a positive number.", 400);
  }

  const validRateTypes = ["HOURLY", "DAILY", "ANNUAL", "C2C", "W2"];
  const finalRateType = (rateType || "").toUpperCase();
  if (!validRateTypes.includes(finalRateType)) {
    throw createWorkflowError(`Invalid rate type '${rateType}'. Allowed: ${validRateTypes.join(", ")}`, 400);
  }

  const updatePayload = {
    rate: rateNum,
    rateType: finalRateType,
  };
  if (availability) {
    updatePayload.availability = availability.trim();
  }

  return await executeTransition(
    submissionId,
    userId,
    WORKFLOW_STATUSES.RATE_CONFIRMED,
    updatePayload
  );
}

/**
 * Step 8 & 9 Combined: Confirm Rate & Availability
 * Handles both sequential steps or updating rates at valid states.
 */
async function confirmRateAndAvailability(submissionId, userId, { rate, rateType, availability }) {
  const submission = await prismRepo.getSubmissionById(submissionId, userId);
  if (!submission) throw createWorkflowError("Submission not found or unauthorized.", 404);

  if (["SUBMITTED", "REJECTED", "WITHDRAWN"].includes(submission.status)) {
    throw createWorkflowError(`Cannot update rate/availability in status '${submission.status}'.`, 400);
  }

  // If in VENDOR_VALIDATED -> First confirm availability, then rate
  if (submission.status === WORKFLOW_STATUSES.VENDOR_VALIDATED) {
    if (!availability) {
      throw createWorkflowError("Availability must be confirmed first.", 400);
    }
    await confirmAvailability(submissionId, userId, { availability });
    if (rate && rateType) {
      return await confirmRate(submissionId, userId, { rate, rateType, availability });
    }
    return await prismRepo.getSubmissionById(submissionId, userId);
  }

  // If in AVAILABILITY_CONFIRMED -> Confirm rate
  if (submission.status === WORKFLOW_STATUSES.AVAILABILITY_CONFIRMED) {
    if (!rate || !rateType) {
      throw createWorkflowError("Rate and rate type are required to confirm rate.", 400);
    }
    return await confirmRate(submissionId, userId, { rate, rateType, availability });
  }

  // If already at or beyond RATE_CONFIRMED (e.g. PENDING_RTR, READY) -> Update values
  return await prismRepo.updateSubmissionRateAvailability(null, submissionId, userId, {
    rate: rate ? Number(rate) : submission.rate,
    rateType: rateType ? rateType.toUpperCase() : submission.rate_type,
    availability: availability || submission.availability,
  });
}

/**
 * Step 10: Initiate RTR (Right to Represent)
 * Transitions RATE_CONFIRMED -> PENDING_RTR
 */
async function initiateRTR(submissionId, userId, { documentUrl, automatic = false, missingDocReason = null } = {}) {
  const sub = await prismRepo.getSubmissionById(submissionId, userId);
  if (!sub) throw createWorkflowError("Submission not found or unauthorized.", 404);

  // Idempotency check: If RTR already exists or submission is at PENDING_RTR / RTR_CONFIRMED
  const existingRTR = await prismRepo.getRTRBySubmissionId(null, sub.id, userId);
  if (existingRTR && (sub.status === WORKFLOW_STATUSES.PENDING_RTR || sub.status === WORKFLOW_STATUSES.RTR_CONFIRMED)) {
    log.info(`[RTR] RTR already exists for submission=${submissionId} status=${sub.status}`);
    return sub;
  }

  // Document Checklist Gate Check
  if (missingDocReason) {
    const client = await pool.connect();
    try {
      await prismRepo.insertAuditLog(client, {
        entityType: "SUBMISSION",
        entityId: submissionId,
        previousStatus: sub.status,
        newStatus: "RTR_BLOCKED_MISSING_DOCUMENT",
        createdBy: userId,
      });
    } finally {
      client.release();
    }
    log.warn(`[RTR] automatic initiation blocked for submission=${submissionId}: ${missingDocReason}`);
    return sub;
  }

  const updatedSub = await executeTransition(
    submissionId,
    userId,
    WORKFLOW_STATUSES.PENDING_RTR,
    {},
    async (client, currentSub) => {
      if (!currentSub.rate || !currentSub.rate_type || !currentSub.availability) {
        throw createWorkflowError("Rate and Availability must be confirmed before initiating RTR.", 400);
      }

      const confirmations = currentSub.confirmation_data || {};
      const consultantStatus = confirmations.consultantConfirmation?.status;
      const vendorStatus = confirmations.vendorConfirmation?.status;

      if (consultantStatus !== "CONFIRMED" || vendorStatus !== "CONFIRMED") {
        log.warn(`[RTR] initiate blocked submission=${submissionId} consultant=${consultantStatus || "PENDING"} vendor=${vendorStatus || "PENDING"}`);
        throw createWorkflowError(
          "RTR cannot be initiated until both consultant and vendor confirm the availability and rate.",
          400,
          "CONFIRMATION_REQUIRED",
          {
            consultantStatus: consultantStatus || "PENDING",
            vendorStatus: vendorStatus || "PENDING",
          }
        );
      }

      if (existingRTR) {
        await prismRepo.updateRTRStatus(client, existingRTR.id, currentSub.id, userId, "SENT", documentUrl);
      } else {
        await prismRepo.createRTR(client, {
          submissionId: currentSub.id,
          status: "SENT",
          documentUrl,
          createdBy: userId,
        });
      }

      await prismRepo.insertAuditLog(client, {
        entityType: "SUBMISSION",
        entityId: currentSub.id,
        previousStatus: currentSub.status,
        newStatus: automatic ? "AUTOMATIC_RTR_INITIATED" : "RTR_INITIATED",
        createdBy: userId,
      });
    }
  );

  // Send RTR Email Package after DB transaction commit (Rule 8: Transaction Safety)
  try {
    const candidateId = updatedSub.candidate_id || updatedSub.candidateId;
    const jobId = updatedSub.job_id || updatedSub.jobId;
    const candidate = await candidateRepo.getCandidateWithCurrentResume(candidateId, userId);
    const job = jobId ? await jobRepo.getJobById(jobId, userId) : null;
    const vendor = job?.vendor_id ? await vendorRepo.getVendorById(job.vendor_id, userId) : null;
    const vendorEmail = vendor?.email || job?.source_email;

    if (vendorEmail) {
      const { buildCanonicalRTREmail } = require("../utils/rtrEmailTemplate");
      const { buildCanonicalRTRDocument } = require("../utils/rtrDocumentTemplate");

      const rtrDoc = buildCanonicalRTRDocument({
        candidateName: candidate?.full_name || candidate?.fullName,
        jobTitle: job?.title,
        clientName: job?.company_name || vendor?.name || "Client",
        requisitionId: job?.id ? `REQ-${job.id.slice(0, 8).toUpperCase()}` : undefined,
        location: job?.location,
        contractType: updatedSub.rate_type || updatedSub.rateType || job?.employment_type || "C2C",
        rate: updatedSub.rate,
        rateType: updatedSub.rate_type || updatedSub.rateType || "HOURLY",
        availability: updatedSub.availability || "Immediate",
        immigrationStatus: candidate?.immigration_status || candidate?.immigrationStatus,
      });

      const rtrEmail = buildCanonicalRTREmail({
        vendorContactName: vendor?.name || "Vendor Partner",
        candidateName: candidate?.full_name || candidate?.fullName,
        jobTitle: job?.title,
        clientName: job?.company_name || vendor?.name || "Client",
        requisitionId: job?.id ? `REQ-${job.id.slice(0, 8).toUpperCase()}` : undefined,
        location: job?.location,
        contractType: updatedSub.rate_type || updatedSub.rateType || job?.employment_type || "C2C",
        rate: updatedSub.rate,
        rateType: updatedSub.rate_type || updatedSub.rateType || "HOURLY",
        availability: updatedSub.availability || "Immediate",
        immigrationStatus: candidate?.immigration_status || candidate?.immigrationStatus,
        attachedDocuments: ["Candidate Resume", "Right to Represent (RTR) Form"],
      });

      const relayAdapter = require("../../../services/relay.adapter");
      await relayAdapter.sendRTREmail({
        submissionId,
        vendorEmail,
        subject: rtrEmail.subject,
        body: rtrEmail.body,
        attachments: [
          { name: "Candidate Resume", type: "resume" },
          { name: "Right to Represent Form", type: "rtr_form", textContent: rtrDoc.textContent },
        ],
      });
    }
  } catch (err) {
    // Email Failure Handling (Rule 9): Log error, remain in PENDING_RTR
    log.error(`[RTR] automatic email package send notice submission=${submissionId} reason=${err.message}`);
    const client = await pool.connect();
    try {
      await prismRepo.insertAuditLog(client, {
        entityType: "SUBMISSION",
        entityId: submissionId,
        previousStatus: "PENDING_RTR",
        newStatus: "RTR_EMAIL_SEND_FAILED",
        createdBy: userId,
      });
    } catch {
      /* ignore */
    } finally {
      client.release();
    }
  }

  return updatedSub;
}

/**
 * Evaluates all RTR gate conditions and automatically triggers initiateRTR if satisfied.
 * Idempotent: checks existing RTR and mandatory document presence before trigger.
 */
async function checkAndTriggerAutomaticRTR(submissionId, userId) {
  const sub = await prismRepo.getSubmissionById(submissionId, userId);
  if (!sub) return null;

  // Gate 1: Submission must be at RATE_CONFIRMED
  if (sub.status !== WORKFLOW_STATUSES.RATE_CONFIRMED) {
    return sub;
  }

  // Gate 2: Rate, Rate Type, Availability must be valid
  if (!sub.rate || !sub.rate_type || !sub.availability) {
    return sub;
  }

  // Gate 3: Both consultant and vendor confirmations must be CONFIRMED
  const confirmations = sub.confirmation_data || sub.confirmationData || {};
  const consultantStatus = confirmations.consultantConfirmation?.status;
  const vendorStatus = confirmations.vendorConfirmation?.status;

  if (consultantStatus !== "CONFIRMED" || vendorStatus !== "CONFIRMED") {
    return sub;
  }

  // Gate 4: Idempotency Check — check if RTR already created
  const existingRTR = await prismRepo.getRTRBySubmissionId(null, sub.id, userId);
  if (existingRTR) {
    log.info(`[RTR] automatic trigger skipped (RTR already exists) submission=${submissionId}`);
    return sub;
  }

  // Gate 5: Document Checklist Gate Check
  const candidateId = sub.candidate_id || sub.candidateId;
  const candidate = await candidateRepo.getCandidateWithCurrentResume(candidateId, userId);
  const resume = await resumeRepo.getResumeById(sub.resume_id || sub.resumeId);

  const hasResume = Boolean(resume || (candidate && candidate.resume_text));
  if (!hasResume) {
    log.warn(`[RTR] automatic trigger blocked for submission=${submissionId}: Missing Candidate Resume`);
    const client = await pool.connect();
    try {
      await prismRepo.insertAuditLog(client, {
        entityType: "SUBMISSION",
        entityId: submissionId,
        previousStatus: sub.status,
        newStatus: "RTR_BLOCKED_MISSING_DOCUMENT",
        createdBy: userId,
      });
    } finally {
      client.release();
    }
    return sub;
  }

  log.info(`[RTR] both-party confirmation complete — automatically initiating RTR for submission=${submissionId}`);
  return await initiateRTR(submissionId, userId, { automatic: true });
}

/**
 * Step 10b: Record RTR Status
 * If SIGNED: Transitions PENDING_RTR -> RTR_CONFIRMED
 * If DECLINED: Transitions PENDING_RTR -> REJECTED
 */
async function recordRTRStatus(submissionId, userId, { status, documentUrl } = {}) {
  const normalized = (status || "").toUpperCase();
  if (!["SIGNED", "DECLINED", "SENT"].includes(normalized)) {
    throw createWorkflowError("RTR status must be 'SIGNED' or 'DECLINED'.", 400);
  }

  if (normalized === "DECLINED") {
    return await executeTransition(
      submissionId,
      userId,
      WORKFLOW_STATUSES.REJECTED,
      {},
      async (client, sub) => {
        const rtr = await prismRepo.getRTRBySubmissionId(client, sub.id, userId);
        if (rtr) {
          await prismRepo.updateRTRStatus(client, rtr.id, sub.id, userId, "DECLINED", documentUrl);
        }
      }
    );
  }

  if (normalized === "SIGNED") {
    return await executeTransition(
      submissionId,
      userId,
      WORKFLOW_STATUSES.RTR_CONFIRMED,
      {},
      async (client, sub) => {
        const rtr = await prismRepo.getRTRBySubmissionId(client, sub.id, userId);
        if (rtr) {
          await prismRepo.updateRTRStatus(client, rtr.id, sub.id, userId, "SIGNED", documentUrl);
        } else {
          await prismRepo.createRTR(client, {
            submissionId: sub.id,
            status: "SIGNED",
            documentUrl,
            createdBy: userId,
          });
        }

        // Publish PRISM Submission Completed event to outbox within transaction
        await platformEvents.publishPrismSubmissionCompleted({
          submissionId: sub.id,
          candidateId: sub.candidate_id,
          jobId: sub.job_id,
          vendorId: sub.vendor_id || sub.vendorId,
          status: WORKFLOW_STATUSES.RTR_CONFIRMED,
          rate: sub.rate,
          rateType: sub.rate_type || sub.rateType,
          availability: sub.availability,
          rtrStatus: "SIGNED",
          completedAt: new Date().toISOString(),
          createdBy: userId,
          client,
        });
      }
    );
  }

  // Sent update
  const rtr = await prismRepo.getRTRBySubmissionId(submissionId, userId);
  if (rtr) {
    await prismRepo.updateRTRStatus(null, rtr.id, submissionId, userId, "SENT", documentUrl);
  }
  return await prismRepo.getSubmissionById(submissionId, userId);
}

/**
 * Step 11: Schedule Interview
 * Saves interview details -> Transitions RTR_CONFIRMED -> INTERVIEW_SCHEDULED
 */
async function scheduleInterview(submissionId, userId, { scheduledAt, interviewType, round, meetingLink, notes, interviewers }) {
  if (!scheduledAt) {
    throw createWorkflowError("scheduledAt date/time is required to schedule interview.", 400);
  }

  const interviewDetails = {
    scheduledAt,
    interviewType: interviewType || "Technical Round",
    round: round || 1,
    meetingLink: meetingLink || null,
    notes: notes || null,
    interviewers: interviewers || [],
    scheduledBy: userId,
    updatedAt: new Date().toISOString(),
  };

  return await executeTransition(
    submissionId,
    userId,
    WORKFLOW_STATUSES.INTERVIEW_SCHEDULED,
    { interviewDetails }
  );
}

/**
 * Step 12: Final Validation
 * Evaluates all 10 gates -> Transitions INTERVIEW_SCHEDULED -> READY
 */
async function executeFinalValidation(submissionId, userId) {
  let finalValidationResult = null;
  return await executeTransition(
    submissionId,
    userId,
    WORKFLOW_STATUSES.READY,
    {},
    async (client, sub) => {
      finalValidationResult = await runFinalValidation(client, sub, userId);
      if (finalValidationResult.status !== "PASSED") {
        throw createWorkflowError(
          `Final validation failed: ${finalValidationResult.failureReasons.join("; ")}`,
          400,
          "FINAL_VALIDATION_FAILED",
          finalValidationResult
        );
      }
    }
  );
}

/**
 * Step 13: Final Submission
 * Verifies all gates inside transaction -> Transitions READY -> SUBMITTED
 */
async function submitFinalSubmission(submissionId, userId) {
  return await executeTransition(
    submissionId,
    userId,
    WORKFLOW_STATUSES.SUBMITTED,
    {},
    async (client, sub) => {
      const finalValidation = await runFinalValidation(client, sub, userId);
      if (finalValidation.status !== "PASSED") {
        throw createWorkflowError(
          `Cannot submit: Final validation gates not satisfied (${finalValidation.failureReasons.join("; ")})`,
          400,
          "FINAL_SUBMISSION_GATE_FAILED",
          finalValidation
        );
      }
    }
  );
}

/**
 * Generic Direct Status Transition Handler (Protected)
 * Validates against state machine transitions and enforces required gates for the target state.
 */
async function transitionStatus(submissionId, userId, targetStatus, metadata = {}) {
  if (!VALID_STATUSES.includes(targetStatus)) {
    throw createWorkflowError(`Invalid status '${targetStatus}'.`, 400);
  }

  switch (targetStatus) {
    case WORKFLOW_STATUSES.PENDING_CONSENT:
      return await requestCandidateConsent(submissionId, userId, metadata);

    case WORKFLOW_STATUSES.CONSENT_REJECTED:
      return await recordCandidateConsentResponse(submissionId, userId, { response: "REJECTED", ...metadata });

    case WORKFLOW_STATUSES.CANDIDATE_VALIDATED:
      return await recordCandidateConsentResponse(submissionId, userId, { response: "ACCEPTED", ...metadata });

    case WORKFLOW_STATUSES.MASKED:
      return await maskCandidateDetails(submissionId, userId, metadata.maskedProfile);

    case WORKFLOW_STATUSES.VENDOR_SUBMITTED:
      return await sendToVendor(submissionId, userId);

    case WORKFLOW_STATUSES.VENDOR_ACCEPTED:
      return await recordVendorResponse(submissionId, userId, { response: "ACCEPTED", ...metadata });

    case WORKFLOW_STATUSES.VENDOR_VALIDATED:
      return await validateVendor(submissionId, userId);

    case WORKFLOW_STATUSES.AVAILABILITY_CONFIRMED:
      return await confirmAvailability(submissionId, userId, metadata);

    case WORKFLOW_STATUSES.RATE_CONFIRMED:
      return await confirmRate(submissionId, userId, metadata);

    case WORKFLOW_STATUSES.PENDING_RTR:
      return await initiateRTR(submissionId, userId, metadata);

    case WORKFLOW_STATUSES.RTR_CONFIRMED:
      return await recordRTRStatus(submissionId, userId, { status: "SIGNED", ...metadata });

    case WORKFLOW_STATUSES.INTERVIEW_SCHEDULED:
      return await scheduleInterview(submissionId, userId, metadata);

    case WORKFLOW_STATUSES.READY:
      return await executeFinalValidation(submissionId, userId);

    case WORKFLOW_STATUSES.SUBMITTED:
      return await submitFinalSubmission(submissionId, userId);

    case WORKFLOW_STATUSES.REJECTED:
      return await executeTransition(submissionId, userId, WORKFLOW_STATUSES.REJECTED);

    case WORKFLOW_STATUSES.WITHDRAWN:
      return await executeTransition(submissionId, userId, WORKFLOW_STATUSES.WITHDRAWN);

    default:
      return await executeTransition(submissionId, userId, targetStatus, metadata);
  }
}

async function getConsentPreview(submissionId, userId, { contractType } = {}) {
  log.info(`[CONSENT] preview submission=${submissionId}`);

  const sub = await prismRepo.getRawSubmissionById(null, submissionId, userId);
  if (!sub) {
    throw createWorkflowError("Submission not found or unauthorized.", 404);
  }

  const candidateId = sub.candidate_id || sub.candidateId;
  const jobId = sub.job_id || sub.jobId;

  log.info(`[CONSENT] submission=${submissionId} candidate=${candidateId || "none"}`);

  const candidate = await candidateRepo.getCandidateWithCurrentResume(candidateId, userId);
  if (!candidate) {
    log.error(`[CONSENT] candidate profile not found submission=${submissionId} candidate=${candidateId || "none"}`);
    throw createWorkflowError("Candidate profile not found.", 404);
  }

  let job = null;
  if (jobId) {
    job = await jobRepo.getJobById(jobId, userId);
  }

  const { buildCanonicalConsentEmail } = require("../utils/consentEmailTemplate");
  const canonical = buildCanonicalConsentEmail({
    candidateName: candidate.full_name || candidate.fullName,
    jobTitle: job?.title,
    location: job?.location,
    contractType: contractType || job?.employment_type || "C2C",
    immigrationStatus: candidate.immigration_status || candidate.immigrationStatus,
    requiredSkills: job?.required_skills,
  });

  log.success("consent preview generated");
  return canonical;
}

async function getVendorPreview(submissionId, userId) {
  log.info(`[VENDOR] preview submission=${submissionId}`);

  const sub = await prismRepo.getSubmissionById(submissionId, userId);
  if (!sub) {
    throw createWorkflowError("Submission not found or unauthorized.", 404);
  }

  const candidateId = sub.candidate_id || sub.candidateId;
  const jobId = sub.job_id || sub.jobId;

  const candidate = await candidateRepo.getCandidateWithCurrentResume(candidateId, userId);
  if (!candidate) {
    throw createWorkflowError("Candidate profile not found.", 404);
  }

  const resume = await resumeRepo.getResumeById(sub.resume_id || sub.resumeId);

  let job = null;
  if (jobId) {
    job = await jobRepo.getJobById(jobId, userId);
  }

  if (!job || !job.vendor_id) {
    throw createWorkflowError("Job does not have an associated Vendor.", 400);
  }

  const vendor = await vendorRepo.getVendorById(job.vendor_id, userId);
  if (!vendor) {
    throw createWorkflowError("Vendor profile not found.", 404);
  }

  const maskedProfile = sub.maskedProfile && sub.maskedProfile.maskedCandidateId
    ? sub.maskedProfile
    : buildMaskedProfile(candidate, resume, job);

  const { buildCanonicalVendorEmail } = require("../utils/vendorEmailTemplate");
  const canonical = buildCanonicalVendorEmail({
    vendorName: vendor.name,
    jobTitle: job.title,
    location: job.location,
    contractType: sub.rateType || job.employment_type || "C2C",
    candidateReference: maskedProfile.maskedCandidateId,
    skills: maskedProfile.skills || job.required_skills,
    experience: maskedProfile.totalExperience || candidate.total_experience,
    immigrationStatus: maskedProfile.immigrationStatus || candidate.immigration_status,
    availability: sub.availability || "Immediate",
    payRate: sub.rate || "Market Rate",
    recruiterName: process.env.RECRUITER_NAME || "Bench Sales Team",
    companyName: process.env.COMPANY_NAME || "Syntra Portal",
  });

  log.success("vendor preview generated");
  return canonical;
}

async function getConsultantConfirmationPreview(submissionId, userId) {
  log.info(`[CONFIRMATION] consultant preview submission=${submissionId}`);

  const sub = await prismRepo.getSubmissionById(submissionId, userId);
  if (!sub) throw createWorkflowError("Submission not found or unauthorized.", 404);

  const candidateId = sub.candidate_id || sub.candidateId;
  const jobId = sub.job_id || sub.jobId;

  const candidate = await candidateRepo.getCandidateWithCurrentResume(candidateId, userId);
  if (!candidate) throw createWorkflowError("Candidate profile not found.", 404);

  let job = null;
  if (jobId) job = await jobRepo.getJobById(jobId, userId);

  const { buildCanonicalConsultantConfirmationEmail } = require("../utils/confirmationEmailTemplate");
  const canonical = buildCanonicalConsultantConfirmationEmail({
    candidateName: candidate.full_name || candidate.fullName,
    jobTitle: job?.title,
    location: job?.location,
    contractType: sub.rate_type || sub.rateType || job?.employment_type || "C2C",
    availability: sub.availability || "Immediate",
    payRate: sub.rate ? `$${sub.rate}/${(sub.rate_type || sub.rateType || "HOURLY").toLowerCase()}` : "Market Rate",
    rateType: sub.rate_type || sub.rateType || "HOURLY",
    recruiterName: process.env.RECRUITER_NAME || "Bench Sales Team",
    companyName: process.env.COMPANY_NAME || "Syntra Portal",
  });

  log.success("consultant confirmation preview generated");
  return canonical;
}

async function getVendorConfirmationPreview(submissionId, userId) {
  log.info(`[CONFIRMATION] vendor preview submission=${submissionId}`);

  const sub = await prismRepo.getSubmissionById(submissionId, userId);
  if (!sub) throw createWorkflowError("Submission not found or unauthorized.", 404);

  const candidateId = sub.candidate_id || sub.candidateId;
  const jobId = sub.job_id || sub.jobId;

  const candidate = await candidateRepo.getCandidateWithCurrentResume(candidateId, userId);
  if (!candidate) throw createWorkflowError("Candidate profile not found.", 404);

  const resume = await resumeRepo.getResumeById(sub.resume_id || sub.resumeId);

  let job = null;
  if (jobId) job = await jobRepo.getJobById(jobId, userId);
  if (!job || !job.vendor_id) throw createWorkflowError("Job does not have an associated Vendor.", 400);

  const vendor = await vendorRepo.getVendorById(job.vendor_id, userId);
  if (!vendor) throw createWorkflowError("Vendor profile not found.", 404);

  const maskedProfile = sub.maskedProfile && sub.maskedProfile.maskedCandidateId
    ? sub.maskedProfile
    : buildMaskedProfile(candidate, resume, job);

  const { buildCanonicalVendorConfirmationEmail } = require("../utils/confirmationEmailTemplate");
  const canonical = buildCanonicalVendorConfirmationEmail({
    vendorName: vendor.name,
    jobTitle: job.title,
    location: job.location,
    contractType: sub.rate_type || sub.rateType || job.employment_type || "C2C",
    candidateReference: maskedProfile.maskedCandidateId,
    skills: maskedProfile.skills || job.required_skills,
    experience: maskedProfile.totalExperience || candidate.total_experience,
    immigrationStatus: maskedProfile.immigrationStatus || candidate.immigration_status,
    availability: sub.availability || "Immediate",
    payRate: sub.rate ? `$${sub.rate}/${(sub.rate_type || sub.rateType || "HOURLY").toLowerCase()}` : "Market Rate",
    rateType: sub.rate_type || sub.rateType || "HOURLY",
    recruiterName: process.env.RECRUITER_NAME || "Bench Sales Team",
    companyName: process.env.COMPANY_NAME || "Syntra Portal",
  });

  log.success("vendor confirmation preview generated");
  return canonical;
}

async function sendConsultantConfirmation(submissionId, userId) {
  const sub = await prismRepo.getSubmissionById(submissionId, userId);
  if (!sub) throw createWorkflowError("Submission not found or unauthorized.", 404);

  const candidateId = sub.candidate_id || sub.candidateId;
  const candidate = await candidateRepo.getCandidateWithCurrentResume(candidateId, userId);
  if (!candidate || !candidate.email) throw createWorkflowError("Candidate does not have a valid email address.", 400);

  const preview = await getConsultantConfirmationPreview(submissionId, userId);

  const confirmationData = sub.confirmationData || sub.confirmation_data || {};
  confirmationData.consultantConfirmation = {
    status: confirmationData.consultantConfirmation?.status || "PENDING",
    lastSentAt: new Date().toISOString(),
  };

  const client = await pool.connect();
  try {
    await prismRepo.updateSubmissionWorkflowData(client, submissionId, userId, { confirmationData });
    await prismRepo.insertAuditLog(client, {
      entityType: "SUBMISSION",
      entityId: submissionId,
      previousStatus: sub.status,
      newStatus: "CONSULTANT_CONFIRMATION_SENT",
      createdBy: userId,
    });
  } finally {
    client.release();
  }

  const relayAdapter = require("../../../services/relay.adapter");
  try {
    await relayAdapter.sendConsultantConfirmationEmail({
      submissionId,
      candidateEmail: candidate.email,
      subject: preview.subject,
      body: preview.body,
    });
  } catch (err) {
    log.error(`[CONFIRMATION] consultant send notice submission=${submissionId} reason=${err.message}`);
  }

  return await prismRepo.getSubmissionById(submissionId, userId);
}

async function sendVendorConfirmation(submissionId, userId) {
  const sub = await prismRepo.getSubmissionById(submissionId, userId);
  if (!sub) throw createWorkflowError("Submission not found or unauthorized.", 404);

  const jobId = sub.job_id || sub.jobId;
  const job = await jobRepo.getJobById(jobId, userId);
  if (!job || !job.vendor_id) throw createWorkflowError("Job does not have an associated Vendor.", 400);

  const vendor = await vendorRepo.getVendorById(job.vendor_id, userId);
  if (!vendor) throw createWorkflowError("Vendor profile not found.", 404);
  const vendorEmail = vendor.email || job.source_email;
  if (!vendorEmail) throw createWorkflowError("Vendor does not have a valid email address.", 400);

  const preview = await getVendorConfirmationPreview(submissionId, userId);

  const confirmationData = sub.confirmationData || sub.confirmation_data || {};
  confirmationData.vendorConfirmation = {
    status: confirmationData.vendorConfirmation?.status || "PENDING",
    lastSentAt: new Date().toISOString(),
  };

  const client = await pool.connect();
  try {
    await prismRepo.updateSubmissionWorkflowData(client, submissionId, userId, { confirmationData });
    await prismRepo.insertAuditLog(client, {
      entityType: "SUBMISSION",
      entityId: submissionId,
      previousStatus: sub.status,
      newStatus: "VENDOR_CONFIRMATION_SENT",
      createdBy: userId,
    });
  } finally {
    client.release();
  }

  const relayAdapter = require("../../../services/relay.adapter");
  try {
    await relayAdapter.sendVendorConfirmationEmail({
      submissionId,
      vendorEmail,
      subject: preview.subject,
      body: preview.body,
    });
  } catch (err) {
    log.error(`[CONFIRMATION] vendor send notice submission=${submissionId} reason=${err.message}`);
  }

  return await prismRepo.getSubmissionById(submissionId, userId);
}

async function recordConsultantConfirmationResponse(submissionId, userId, { response, notes } = {}) {
  const normalized = (response || "").toUpperCase();
  const isConfirmed = ["YES", "CONFIRMED", "ACCEPTED", "APPROVED"].includes(normalized);
  const isDeclined = ["NO", "DECLINED", "REJECTED"].includes(normalized);

  if (!isConfirmed && !isDeclined) {
    throw createWorkflowError("Response must be 'CONFIRMED' or 'DECLINED'.", 400);
  }

  const sub = await prismRepo.getSubmissionById(submissionId, userId);
  if (!sub) throw createWorkflowError("Submission not found or unauthorized.", 404);

  const confirmationData = sub.confirmationData || sub.confirmation_data || {};
  const status = isConfirmed ? "CONFIRMED" : "DECLINED";
  confirmationData.consultantConfirmation = {
    ...confirmationData.consultantConfirmation,
    status,
    respondedAt: new Date().toISOString(),
    notes: notes || null,
  };

  const client = await pool.connect();
  try {
    await prismRepo.updateSubmissionWorkflowData(client, submissionId, userId, { confirmationData });
    await prismRepo.insertAuditLog(client, {
      entityType: "SUBMISSION",
      entityId: submissionId,
      previousStatus: sub.status,
      newStatus: isConfirmed ? "CONSULTANT_CONFIRMED" : "CONSULTANT_DECLINED",
      createdBy: userId,
    });
  } finally {
    client.release();
  }

  if (isConfirmed) {
    await checkAndTriggerAutomaticRTR(submissionId, userId);
  }

  return await prismRepo.getSubmissionById(submissionId, userId);
}

async function recordVendorConfirmationResponse(submissionId, userId, { response, notes } = {}) {
  const normalized = (response || "").toUpperCase();
  const isConfirmed = ["YES", "CONFIRMED", "ACCEPTED", "APPROVED"].includes(normalized);
  const isDeclined = ["NO", "DECLINED", "REJECTED"].includes(normalized);

  if (!isConfirmed && !isDeclined) {
    throw createWorkflowError("Response must be 'CONFIRMED' or 'DECLINED'.", 400);
  }

  const sub = await prismRepo.getSubmissionById(submissionId, userId);
  if (!sub) throw createWorkflowError("Submission not found or unauthorized.", 404);

  const confirmationData = sub.confirmationData || sub.confirmation_data || {};
  const status = isConfirmed ? "CONFIRMED" : "DECLINED";
  confirmationData.vendorConfirmation = {
    ...confirmationData.vendorConfirmation,
    status,
    respondedAt: new Date().toISOString(),
    notes: notes || null,
  };

  const client = await pool.connect();
  try {
    await prismRepo.updateSubmissionWorkflowData(client, submissionId, userId, { confirmationData });
    await prismRepo.insertAuditLog(client, {
      entityType: "SUBMISSION",
      entityId: submissionId,
      previousStatus: sub.status,
      newStatus: isConfirmed ? "VENDOR_CONFIRMED" : "VENDOR_DECLINED",
      createdBy: userId,
    });
  } finally {
    client.release();
  }

  if (isConfirmed) {
    await checkAndTriggerAutomaticRTR(submissionId, userId);
  }

  return await prismRepo.getSubmissionById(submissionId, userId);
}

module.exports = {
  WORKFLOW_STATUSES,
  VALID_STATUSES,
  TRANSITIONS,

  runCandidateValidation,
  buildMaskedProfile,
  runVendorValidation,
  runFinalValidation,

  requestCandidateConsent,
  recordCandidateConsentResponse,
  validateCandidate,
  maskCandidateDetails,
  resolveVendorForJob,
  sendToVendor,
  recordVendorResponse,
  validateVendor,
  confirmAvailability,
  confirmRate,
  confirmRateAndAvailability,
  initiateRTR,
  checkAndTriggerAutomaticRTR,
  recordRTRStatus,
  scheduleInterview,
  executeFinalValidation,
  submitFinalSubmission,
  transitionStatus,
  getConsentPreview,
  getVendorPreview,
  getConsultantConfirmationPreview,
  getVendorConfirmationPreview,
  sendConsultantConfirmation,
  sendVendorConfirmation,
  recordConsultantConfirmationResponse,
  recordVendorConfirmationResponse,
};
