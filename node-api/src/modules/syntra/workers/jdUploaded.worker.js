const crypto = require("crypto");
const jobRepo = require("../../../repositories/job.repository");
const { runForJob } = require("../matching/funnel");
const { parseJD } = require("../../../ai/jdParsing");
const { generateEmbedding } = require("../../../ai/embedding");
const log = require("../../../utils/logger");
const platformEvents = require("../../../services/platformEvents.service");
const env = require("../../../config/env");

function summaryHash(summary) {
  return crypto.createHash("sha256").update(summary || "", "utf8").digest("hex");
}

function validateJdDocument(text = "", originalFileName = "") {
  const lowerName = (originalFileName || "").toLowerCase();

  let resumeScore = 0;
  let jdScore = 0;

  // 1. Filename indicators
  if (/\b(?:resume|cv|curriculum_vitae)\b/i.test(lowerName) || /_cv\b/i.test(lowerName)) resumeScore += 5;
  if (/^\d{1,3}_[a-zA-Z]+_[a-zA-Z]+/i.test(lowerName)) resumeScore += 3; // e.g. 09_Olivia_Martin_QA.docx, 03_Daniel_Kim_Python_Data
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

  // Decision logic: Flag as Candidate Resume only when resume indicators overwhelmingly dominate
  if (resumeScore >= 6 && resumeScore > jdScore + 2) {
    return {
      isValid: false,
      reason: `The uploaded file '${originalFileName || 'document'}' appears to be a Candidate Resume, not a Job Description. Please upload it under the 'Resume' tab to parse candidate profile attributes.`
    };
  }

  return { isValid: true };
}

async function handleJdUploaded(job) {
  const { jobId } = job.data || {};
  if (!jobId) throw new Error("jd.uploaded missing jobId");

  const row = await jobRepo.getJobById(jobId);
  if (!row) throw new Error(`Job not found: ${jobId}`);

  const text = (row.raw_text || "").trim();
  if (!text) {
    const errorMsg = "The uploaded file contained no readable text. Please upload a valid PDF, DOCX, or TXT file.";
    await jobRepo.markFailed(jobId, errorMsg);
    log.error(`[jd.uploaded] Failed for job ${jobId}: ${errorMsg}`);
    return;
  }

  // Validate document type mismatch (UX Guard)
  const docValidation = validateJdDocument(text, row.original_file_name);
  if (!docValidation.isValid) {
    log.warn(`[jd.uploaded] Document mismatch for job ${jobId}: ${docValidation.reason}`);
    await jobRepo.markFailed(jobId, docValidation.reason);
    return;
  }

  await jobRepo.markProcessing(jobId);
  try {
    // 1. LLM Extraction (Strict - fails visibly if LLM fails)
    const parsedData = await parseJD({ jdText: text });
    const summary = parsedData.summary || "";

    // Safely combine required, mandatory, and preferred skills.
    let skillsSet = new Set();
    [...(parsedData.required_skills || []), 
     ...(parsedData.mandatory_skills || []), 
     ...(parsedData.preferred_skills || [])].forEach(s => skillsSet.add(s));

    const newHash = summaryHash(summary);
    const embeddingText = parsedData.embedding_text || `${parsedData.title || ''} ${summary} ${Array.from(skillsSet).join(' ')}`.trim();

    // 2. Vector Embedding Generation (Strict - fails visibly if embedding generation fails)
    let embeddingVector;
    let embeddingModel = "text-embedding-3-small";
    let embeddingVersion = "v1";

    if (row.summary_hash === newHash && row.embedding) {
      log.info(`[jd.uploaded] Embedding reused for job ${jobId} (summary_hash unchanged)`);
      embeddingVector = row.embedding;
    } else {
      try {
        const embResult = await generateEmbedding(embeddingText);
        embeddingVector = embResult.embedding;
        embeddingModel = embResult.model;
        embeddingVersion = embResult.version;
        log.info(`[jd.uploaded] Generated vector embedding for job ${jobId} (${embeddingVector?.length}-dim)`);
      } catch (embErr) {
        log.error(`[jd.uploaded] Embedding generation failed for job ${jobId}: ${embErr.message}`);
        throw new Error(`Vector embedding generation failed: ${embErr.message}`);
      }
    }

    // 3. Atomically persist parsed fields + embedding vector + mark processed
    await jobRepo.saveAiResultAndEmbedding(jobId, {
      summary: summary,
      skills: Array.from(skillsSet),
      primaryRole: parsedData.title || "other",
      summaryHash: newHash,
      embedding: embeddingVector,
      embeddingModel,
      embeddingVersion,
    });

    log.info(`[jd.uploaded] job ${jobId} successfully parsed and embedded`);

    const parsedEvent = await platformEvents.publishJdParsed({ jobId });
    if (!parsedEvent) {
      log.warn(
        `[jd.uploaded] syntra.jd.parsed was not written to event_outbox — ` +
          `check PLATFORM_EVENTS_ENABLED and node-api logs for [platformEvents] failed`,
      );
    }

    // When orchestrator owns matching, jd.parsed → syntra.continuous.match runs funnel via HTTP.
    // Skip local funnel here to avoid duplicate shortlists / match.requested rows.
    if (env.ORCH_DELEGATE_MATCH && env.PLATFORM_EVENTS_ENABLED) {
      log.info(
        `[jd.uploaded] ORCH_DELEGATE_MATCH=1 — funnel deferred to orchestrator (syntra.jd.parsed → continuous-match)`,
      );
      return;
    }

    log.info(`[jd.uploaded] running local matching funnel for job ${jobId}`);
    await runForJob(jobId);
  } catch (err) {
    const errMsg = err.message || "AI analysis failed to process this Job Description.";
    await jobRepo.markFailed(jobId, errMsg);
    log.error(`[jd.uploaded] FAILED job=${jobId}: ${errMsg}`);
    throw err;
  }
}

function registerJdUploadedWorker(boss) {
  return boss.work("jd.uploaded", async ([job]) => {
    try {
      await handleJdUploaded(job);
    } catch (err) {
      log.error(
        `[jd.uploaded] FAILED job=${job?.data?.jobId || "?"} pgBossId=${job?.id}: ${err.message}`
      );
      log.error(err.stack || err);
      throw err;
    }
  });
}

module.exports = { registerJdUploadedWorker, handleJdUploaded, validateJdDocument };
