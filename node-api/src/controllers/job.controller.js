const jobService = require("../services/job.service");
const jobRepo = require("../repositories/job.repository");

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(id) {
  return typeof id === "string" && UUID_REGEX.test(id);
}

async function uploadJob(req, res, next) {
  try {
    if (!req.file) {
      const err = new Error("No file uploaded (field name must be 'file')");
      err.statusCode = 400;
      throw err;
    }
    const jobId = await jobService.createJob({
      title: req.body.title,
      file: req.file,
      userId: req.userId,
      orgId: req.orgId,
    });
    res.status(202).json({ jobId, status: "accepted" });
  } catch (err) {
    next(err);
  }
}

function resolveSourceName(row) {
  if (row.source_email) return "email";
  const msgId = (row.message_id || "").toLowerCase();
  if (msgId.startsWith("adzuna:")) return "adzuna";
  if (msgId.startsWith("jooble:")) return "jooble";
  if (msgId.startsWith("indeed:")) return "indeed";
  if (msgId.startsWith("jobpipe:")) return "jobpipe";
  if (msgId.startsWith("monster:")) return "monster";
  if (msgId.startsWith("<") || msgId.includes("@")) return "email";
  if (row.original_file_name || (!row.message_id && !row.source_url)) return "manual";
  return "job_board";
}

function mapJobListItem(row) {
  let skills = row.required_skills || [];
  if (typeof skills === "string") {
    try {
      skills = JSON.parse(skills);
    } catch {
      skills = [];
    }
  }
  if (!Array.isArray(skills)) skills = [];
  
  // Fallback threshold to 50 if null or 0 for legacy jobs
  const threshold = (!row.score_threshold || row.score_threshold === 0) 
    ? 50 
    : row.score_threshold;

  let matchScores = [];
  if (Array.isArray(row.match_scores)) {
    matchScores = row.match_scores;
  } else if (typeof row.match_scores === "string") {
    try {
      matchScores = JSON.parse(row.match_scores);
    } catch {
      matchScores = [];
    }
  }

  return {
    id: row.id,
    title: row.title,
    originalFileName: row.original_file_name,
    primaryRole: row.primary_role,
    requiredSkills: skills,
    uploadedAt: row.uploaded_at,
    processingStatus: row.processing_status,
    processingError: row.processing_error || null,
    matchCount: Number(row.match_count) || 0,
    status: row.status || "Active",
    location: row.location || null,
    scoreThreshold: threshold,
    matchScores: matchScores,
    companyName: row.company_name || null,
    sourceUrl: row.source_url || null,
    sourceEmail: row.source_email || null,
    messageId: row.message_id || null,
    employmentType: row.employment_type || null,
    visaRequirement: row.visa_requirement || null,
    remotePolicy: row.remote_policy || null,
    minExperience: row.min_experience != null ? Number(row.min_experience) : null,
    maxExperience: row.max_experience != null ? Number(row.max_experience) : null,
    sourceName: resolveSourceName(row),
  };
}

async function listJobs(req, res, next) {
  try {
    const { rows, total } = await jobRepo.listJobs({
      userId: req.userId,
      limit: req.query.limit,
    });
    res.json({ jobs: rows.map(mapJobListItem), total });
  } catch (err) {
    next(err);
  }
}

async function deleteJob(req, res, next) {
  try {
    const { jobId } = req.params;
    if (!jobId || !isValidUuid(jobId)) {
      return res.status(400).json({
        error: "invalid_job_id",
        message: "Job ID must be a valid UUID",
      });
    }
    const ok = await jobRepo.deleteJob(jobId, req.userId);
    if (!ok) {
      return res.status(404).json({
        error: "job_not_found",
        message: `Job not found: ${jobId}`,
      });
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function getJob(req, res, next) {
  try {
    const row = await jobRepo.getJobById(req.params.jobId, req.userId);
    if (!row) {
      const err = new Error(`Job not found: ${req.params.jobId}`);
      err.statusCode = 404;
      throw err;
    }

    let skills = row.required_skills || [];
    if (typeof skills === "string") {
      try {
        skills = JSON.parse(skills);
      } catch {
        skills = [];
      }
    }
    if (!Array.isArray(skills)) skills = [];

    const isFailed = Boolean(row.processing_failed_at);
    const processingStatus = isFailed ? "failed" : (row.processed_at ? "processed" : "processing");

    const job = {
      id: row.id,
      title: row.title,
      originalFileName: row.original_file_name,
      primaryRole: row.primary_role,
      requiredSkills: skills,
      uploadedAt: row.uploaded_at,
      processedAt: row.processed_at,
      processingFailedAt: row.processing_failed_at,
      processingStatus: processingStatus,
      processingError: row.processing_error || null,
      status: row.status || "Active",
      location: row.location || null,
      summary: row.jd_summary,
      scoreThreshold: row.score_threshold || 50,
      companyName: row.company_name || null,
      sourceUrl: row.source_url || null,
      sourceEmail: row.source_email || null,
      messageId: row.message_id || null,
      employmentType: row.employment_type || null,
      visaRequirement: row.visa_requirement || null,
      remotePolicy: row.remote_policy || null,
      minExperience: row.min_experience != null ? Number(row.min_experience) : null,
      maxExperience: row.max_experience != null ? Number(row.max_experience) : null,
      sourceName: resolveSourceName(row),
    };

    res.json({ job });
  } catch (err) {
    next(err);
  }
}

async function deleteJobsBulk(req, res, next) {
  try {
    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const validIds = rawIds.filter(isValidUuid);
    if (!validIds.length) {
      return res.status(400).json({
        error: "invalid_ids",
        message: "Provide ids: string[] containing valid UUIDs",
      });
    }
    const result = await jobRepo.deleteJobs(validIds, req.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function bulkSaveJobs(req, res, next) {
  try {
    const { jobIds } = req.body;
    if (!jobIds || !Array.isArray(jobIds)) {
      return res.status(400).json({ message: "jobIds array is required" });
    }
    const count = await jobService.bulkSaveJobs(jobIds, req.userId);
    if (count === 0) {
      return res.status(409).json({
        message:
          "No jobs were saved. The job may still be processing, failed parsing, or belong to another user.",
        count: 0,
      });
    }
    res.json({ message: "Jobs saved successfully", count });
  } catch (err) {
    next(err);
  }
}

async function retryJob(req, res, next) {
  try {
    const { jobId } = req.params;
    if (!jobId) {
      return res.status(400).json({ message: "jobId is required" });
    }
    const result = await jobService.retryJob(jobId, req.userId);
    res.status(202).json({
      jobId: result.jobId,
      status: "accepted"
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  uploadJob,
  listJobs,
  getJob,
  deleteJob,
  deleteJobsBulk,
  bulkSaveJobs,
  retryJob,
  mapJobListItem,
};
