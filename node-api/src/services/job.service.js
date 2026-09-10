const { withTransaction } = require("../config/db");
const jobRepo = require("../repositories/job.repository");
const { extractText } = require("./extraction/fileExtractor");
const { getBoss } = require("../config/queue");
const log = require("../utils/logger");
const platformEvents = require("./platformEvents.service");

/**
 * Extract text → insert job with raw_text → enqueue jd.uploaded.
 * Returns jobId for the 202 response (processing continues in pg-boss).
 */
async function createJob({ title, file, userId, orgId }) {
  const rawText = await extractText(file.path);

  const job = await withTransaction(async (client) => {
    return jobRepo.insertJob(client, {
      title,
      originalFileName: file.originalname,
      filePath: file.path,
      mimeType: file.mimetype,
      rawText,
      createdBy: userId,
      orgId,
    });
  });

  await getBoss().send("jd.uploaded", { jobId: job.id });
  await platformEvents.publishJdReceived({
    jobId: job.id,
    title,
    rawText,
  });
  log.info(`Job accepted ${job.id} → jd.uploaded queued`);
  return job.id;
}

async function bulkSaveJobs(jobIds, userId) {
  const jobRepo = require("../repositories/job.repository");
  const count = await jobRepo.saveJobsBulk(jobIds, userId);
  if (count > 0) {
    log.info(`[job.save] ${count} job(s) activated — announcing`);
    // Announce the fact; SYNTRA re-runs its funnel. This used to call
    // runForJob directly, fire-and-forget, so a failure vanished into a log
    // line. Queued, it retries — and saving a job no longer depends on SYNTRA.
    for (const jobId of jobIds) {
      await getBoss().send("job.activated", { jobId });
    }
  }
  return count;
}

async function retryJob(jobId, userId) {
  const jobRepo = require("../repositories/job.repository");
  const { getBoss } = require("../config/queue");
  const log = require("../utils/logger");
  const fs = require("fs");

  const job = await jobRepo.getJobById(jobId, userId);
  if (!job) {
    const error = new Error("Job not found or unauthorized");
    error.statusCode = 404;
    throw error;
  }

  if (job.file_path && !fs.existsSync(job.file_path)) {
    log.warn(`[job.retry] Original file missing job=${jobId}`);
    const error = new Error("The original JD file is no longer available. Please upload the file again.");
    error.statusCode = 409;
    throw error;
  }

  const rowCount = await jobRepo.resetProcessingState(jobId);
  if (rowCount === 0) {
    log.warn(`[job.retry] Retry rejected; job is not in FAILED state job=${jobId}`);
    const error = new Error("This job is already being processed or is not in a failed state.");
    error.statusCode = 409;
    throw error;
  }

  log.info(`[job.retry] Retry requested job=${jobId}`);

  await getBoss().send("jd.uploaded", {
    jobId: jobId,
  });

  log.info(`[job.retry] Job transitioned FAILED → QUEUED job=${jobId}`);

  return { jobId };
}

module.exports = { createJob, bulkSaveJobs, retryJob };
