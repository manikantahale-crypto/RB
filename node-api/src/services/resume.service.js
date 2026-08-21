const { withTransaction } = require("../config/db");
const candidateRepo = require("../repositories/candidate.repository");
const resumeRepo = require("../repositories/resume.repository");
const { extractText } = require("./extraction/fileExtractor");
const { checkDuplicateResume } = require("../validation/duplicateValidation");
const { getBoss } = require("../config/queue");
const log = require("../utils/logger");
const platformEvents = require("./platformEvents.service");

/**
 * Extract text → insert candidate+resume with raw_text → enqueue resume.uploaded.
 */
async function createResume({ fullName, email, phone, file, userId }) {
  const rawText = await extractText(file.path);

  const dupCheck = await checkDuplicateResume(rawText, userId);
  if (dupCheck.isDuplicate) {
    log.info(`[DuplicateCheck] existing resume=${dupCheck.existingResumeId} candidate=${dupCheck.existingCandidateId} candidateStatus=${dupCheck.candidateStatus} processingStatus=${dupCheck.processingStatus}`);

    if (dupCheck.candidateStatus === 'Active') {
      log.info(`[ResumeUpload] Duplicate blocked resume=${dupCheck.existingResumeId} user=${userId}`);
      return { resumeId: dupCheck.existingResumeId, candidateId: dupCheck.existingCandidateId, status: "duplicate" };
    }
    
    if (dupCheck.processingStatus === 'processing' || dupCheck.processingStatus === 'uploaded') {
      log.info(`[ResumeUpload] Duplicate blocked resume=${dupCheck.existingResumeId} user=${userId}`);
      return { resumeId: dupCheck.existingResumeId, candidateId: dupCheck.existingCandidateId, status: "duplicate" };
    }

    if (dupCheck.candidateStatus === 'Staging' && dupCheck.processingStatus === 'completed') {
      log.info(`[ResumeUpload] Duplicate blocked resume=${dupCheck.existingResumeId} user=${userId}`);
      return { resumeId: dupCheck.existingResumeId, candidateId: dupCheck.existingCandidateId, status: "duplicate" };
    }

    if (dupCheck.candidateStatus === 'Staging' && dupCheck.processingStatus === 'failed') {
      log.info(`[ResumeUpload] Recycling failed staging resume=${dupCheck.existingResumeId}`);
      
      const rowCount = await resumeRepo.resetProcessingState(dupCheck.existingResumeId);
      if (rowCount > 0) {
        log.info(`[ResumeUpload] Failed resume reset successfully resume=${dupCheck.existingResumeId}`);
        log.info(`[ResumeUpload] Queueing resume.uploaded resume=${dupCheck.existingResumeId}`);
        await getBoss().send("resume.uploaded", {
          resumeId: dupCheck.existingResumeId,
          candidateId: dupCheck.existingCandidateId,
        });
        
        // Return without 'duplicate' status so the controller returns 202 Accepted.
        // This triggers the frontend to smoothly treat it as a new upload and poll it.
        return { 
          resumeId: dupCheck.existingResumeId, 
          candidateId: dupCheck.existingCandidateId 
        };
      }
      
      // Fallback if reset failed (race condition)
      return { resumeId: dupCheck.existingResumeId, candidateId: dupCheck.existingCandidateId, status: "duplicate" };
    }
  }

  const { candidate, resume } = await withTransaction(async (client) => {
    const candidate = await candidateRepo.insertCandidate(client, {
      fullName,
      email,
      phone,
      createdBy: userId,
    });

    const resume = await resumeRepo.insertResume(client, {
      candidateId: candidate.id,
      originalFileName: file.originalname,
      filePath: file.path,
      mimeType: file.mimetype,
      rawText,
    });

    return { candidate, resume };
  });

  await getBoss().send("resume.uploaded", {
    resumeId: resume.id,
    candidateId: candidate.id,
  });
  await platformEvents.publishResumeReceived({
    resumeId: resume.id,
    candidateId: candidate.id,
    rawText,
  });
  log.info(
    `Resume accepted ${resume.id} (candidate ${candidate.id}) → resume.uploaded queued`
  );
  return { resumeId: resume.id, candidateId: candidate.id };
}

async function bulkSaveCandidates(candidateIds, userId) {
  const resumeRepo = require("../repositories/resume.repository");
  const candidateRepo = require("../repositories/candidate.repository");
  const count = await candidateRepo.saveCandidatesBulk(candidateIds, userId);
  return count;
}

async function retryResume(resumeId, userId) {
  const resumeRepo = require("../repositories/resume.repository");
  const { getBoss } = require("../config/queue");
  const log = require("../utils/logger");
  const fs = require("fs");

  const resume = await resumeRepo.getResumeWithCandidate(resumeId, userId);
  if (!resume) {
    const error = new Error("Resume not found or unauthorized");
    error.statusCode = 404;
    throw error;
  }

  if (resume.file_path && !fs.existsSync(resume.file_path)) {
    log.warn(`[resume.retry] Original file missing resume=${resume.id}`);
    const error = new Error("The original resume file is no longer available. Please upload the resume again.");
    error.statusCode = 409;
    throw error;
  }

  const rowCount = await resumeRepo.resetProcessingState(resumeId);
  if (rowCount === 0) {
    log.warn(`[resume.retry] Retry rejected; resume is not in FAILED state resume=${resume.id}`);
    const error = new Error("This resume is already being processed or is not in a failed state.");
    error.statusCode = 409;
    throw error;
  }

  log.info(`[resume.retry] Retry requested resume=${resume.id}`);

  await getBoss().send("resume.uploaded", {
    resumeId: resume.id,
    candidateId: resume.candidate_id,
  });

  log.info(`[resume.retry] Resume transitioned FAILED → QUEUED resume=${resume.id}`);

  return { resumeId: resume.id, candidateId: resume.candidate_id };
}

module.exports = { createResume, bulkSaveCandidates, retryResume };
