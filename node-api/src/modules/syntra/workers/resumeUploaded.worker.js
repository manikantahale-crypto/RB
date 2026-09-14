const crypto = require("crypto");
const resumeRepo = require("../../../repositories/resume.repository");
const candidateRepo = require("../../../repositories/candidate.repository");
const { runForResume } = require("../matching/funnel");
const { parseResume } = require("../../../ai/resumeParsing");
const { validateCandidateData } = require("../../../validation/candidateValidation");
const { generateEmbedding } = require("../../../ai/embedding");
const log = require("../../../utils/logger");
const platformEvents = require("../../../services/platformEvents.service");

function summaryHash(summary) {
  return crypto.createHash("sha256").update(summary || "", "utf8").digest("hex");
}

function validateResumeDocument(text = "", originalFileName = "") {
  const lowerName = (originalFileName || "").toLowerCase();

  let resumeScore = 0;
  let jdScore = 0;

  // 1. Filename indicators
  if (/\b(?:resume|cv|curriculum_vitae)\b/i.test(lowerName) || /_cv\b/i.test(lowerName)) resumeScore += 5;
  if (/^\d{1,3}_[a-zA-Z]+_[a-zA-Z]+/i.test(lowerName)) resumeScore += 3;
  if (/\b(?:jd|job_description|job_desc|job_spec|requirement|req_)\b/i.test(lowerName)) jdScore += 5;

  // 2. Candidate Resume Specific Patterns & Sections
  if (/\b(?:professional summary|executive summary|profile summary|summary of qualifications|about me)\b/i.test(text)) resumeScore += 3;
  if (/\b(?:professional experience|work experience|employment history|project experience|career history)\b/i.test(text)) resumeScore += 3;
  if (/\b(?:technical skills|skills & expertise|core competencies|tools & technologies)\b/i.test(text)) resumeScore += 2;
  if (/\b(?:education|academic background|bachelor's degree|master's degree|b\.tech|m\.tech|b\.s\.|m\.s\.)\b/i.test(text)) resumeScore += 2;
  if (/\b(?:consultant type|consultant classification|work authorization|immigration status|visa status|availability & preferences)\b/i.test(text)) resumeScore += 5;
  if (/\b(?:available immediately|within 2 weeks|current location:|preferred location:)\b/i.test(text)) resumeScore += 4;
  if (/\b(?:is a [a-zA-Z\s]+ with \d+\+? years of experience supporting|has \d+\+? years of experience in)\b/i.test(text)) resumeScore += 4;
  if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text.slice(0, 500)) && /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(text.slice(0, 500))) resumeScore += 4;

  // 3. Job Description Specific Patterns & Sections
  if (/\b(?:job description|about the role|position overview|role summary|position summary)\b/i.test(text)) jdScore += 5;
  if (/\b(?:key responsibilities|duties & responsibilities|what you will do|what you'll do|core responsibilities)\b/i.test(text)) jdScore += 4;
  if (/\b(?:required qualifications|minimum qualifications|basic qualifications|must have|minimum requirements)\b/i.test(text)) jdScore += 4;
  if (/\b(?:we are seeking|we are looking for|our client is looking|our client is seeking|the ideal candidate will|looking for a|seeking a)\b/i.test(text)) jdScore += 5;
  if (/\b(?:bill rate|c2c rate|hourly rate|end client:|client organization:)\b/i.test(text)) jdScore += 4;

  // Decision logic: Flag as Job Description only when JD indicators overwhelmingly dominate
  if (jdScore >= 6 && jdScore > resumeScore + 2) {
    return {
      isValid: false,
      reason: `The uploaded file '${originalFileName || 'document'}' appears to be a Job Description, not a Candidate Resume. Please upload it under the 'Job Description' tab.`
    };
  }

  return { isValid: true };
}

/**
 * @param {object} job
 * @param {{ matchThreshold?: number, topN?: number }} [options]
 *   Settings from the workflow step that asked for this. This step DOES match
 *   — it runs the resume-against-jobs funnel once the profile is embedded —
 *   so the floor and the shortlist size genuinely apply here.
 */
async function handleResumeUploaded(job, options = {}) {
  const { resumeId, candidateId: payloadCandidateId } = job.data || {};
  if (!resumeId) throw new Error("resume.uploaded missing resumeId");

  const row = await resumeRepo.getResumeById(resumeId);
  if (!row) throw new Error(`Resume not found: ${resumeId}`);

  const text = (row.raw_text || "").trim();
  if (!text) {
    const errorMsg = "The uploaded file contained no readable text. Please upload a valid PDF, DOCX, or TXT resume.";
    await resumeRepo.markFailed(resumeId, errorMsg);
    log.error(`[resume.uploaded] Failed for resume ${resumeId}: ${errorMsg}`);
    return;
  }

  const candidateId = payloadCandidateId || row.candidate_id;

  // Validate document type mismatch (UX Guard)
  const docValidation = validateResumeDocument(text, row.original_file_name);
  if (!docValidation.isValid) {
    log.warn(`[resume.uploaded] Document mismatch for resume ${resumeId}: ${docValidation.reason}`);
    await resumeRepo.markFailed(resumeId, docValidation.reason);
    return;
  }

  await resumeRepo.markProcessing(resumeId);
  try {
    // 1. LLM Extraction (Strict - fails visibly if LLM fails)
    const rawParsedData = await parseResume(text);
    const parsedData = validateCandidateData(rawParsedData);
    
    const summary = parsedData.summary || parsedData.ai_summary || "";
    const newHash = summaryHash(summary);
    const embeddingText = parsedData.embedding_text || `${parsedData.job_title || parsedData.current_role || ''} ${(parsedData.skills || []).join(' ')} ${parsedData.total_experience || ''} ${summary}`.trim();

    // 2. Vector Embedding Generation (Strict - fails visibly if embedding generation fails)
    let embeddingVector;
    let embeddingModel = "text-embedding-3-small";
    let embeddingVersion = "v1";

    if (row.summary_hash === newHash && row.embedding) {
      log.info(`[resume.uploaded] Embedding reused for resume ${resumeId} (summary_hash unchanged)`);
      embeddingVector = row.embedding;
    } else {
      try {
        const embResult = await generateEmbedding(embeddingText);
        embeddingVector = embResult.embedding;
        embeddingModel = embResult.model;
        embeddingVersion = embResult.version;
        log.info(`[resume.uploaded] Generated vector embedding for resume ${resumeId} (${embeddingVector?.length}-dim)`);
      } catch (embErr) {
        log.error(`[resume.uploaded] Embedding generation failed for resume ${resumeId}: ${embErr.message}`);
        throw new Error(`Vector embedding generation failed: ${embErr.message}`);
      }
    }

    // 3. Atomically persist parsed fields + embedding vector
    await resumeRepo.saveAiResultAndEmbedding(resumeId, {
      summary: summary,
      skills: parsedData.skills || [],
      primaryRole: parsedData.primary_skill || "other",
      summaryHash: newHash,
      minRate: parsedData.min_rate || "",
      education: parsedData.education || [],
      experience: parsedData.experience || "",
      totalExperience: parsedData.total_experience || "",
      currentCompany: parsedData.current_company || "",
      currentRole: parsedData.current_role || "",
      profileSummary: parsedData.ai_summary || summary,
      embedding: embeddingVector,
      embeddingModel,
      embeddingVersion,
    });

    if (candidateId) {
      await candidateRepo.saveProfileFields(candidateId, {
        fullName: parsedData.full_name || "",
        email: parsedData.email || "",
        phone: parsedData.phone || "",
        immigrationStatus: parsedData.immigration_status || parsedData.visa_status || "",
        location: parsedData.current_location || [parsedData.city, parsedData.state].filter(Boolean).join(", ") || "",
        linkedin: parsedData.linkedin || "",
        github: parsedData.github || "",
      });
    }

    log.info(`[resume.uploaded] resume ${resumeId} successfully parsed & embedded; running funnel`);

    await platformEvents.publishProfilePrepared({ resumeId, candidateId });

    // 4. Run matching funnel ONLY after both parsed fields and embedding are saved
    await runForResume(resumeId, options);
  } catch (err) {
    const errMsg = err.message || "AI analysis failed to extract candidate attributes from this resume.";
    await resumeRepo.markFailed(resumeId, errMsg);
    log.error(`[resume.uploaded] FAILED resumeId=${resumeId}: ${errMsg}`);
    throw err;
  }
}

function registerResumeUploadedWorker(boss) {
  return boss.work("resume.uploaded", async ([job]) => {
    try {
      await handleResumeUploaded(job);
    } catch (err) {
      log.error(
        `[resume.uploaded] FAILED resumeId=${job?.data?.resumeId || "?"} pgBossId=${job?.id}: ${err.message}`
      );
      log.error(err.stack || err);
      throw err;
    }
  });
}

module.exports = { registerResumeUploadedWorker, handleResumeUploaded, validateResumeDocument };
