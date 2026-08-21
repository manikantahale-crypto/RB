const { pool } = require("../config/db");

// Job Repositories
async function getJob(jobId) {
  const { rows } = await pool.query(
    "SELECT id, file_path, jd_summary FROM syntra.jobs WHERE id = $1",
    [jobId]
  );
  return rows[0];
}

async function markJobProcessing(jobId) {
  await pool.query(
    "UPDATE syntra.jobs SET processing_started_at = now() WHERE id = $1",
    [jobId]
  );
}

async function saveJobSummary(jobId, summary) {
  await pool.query(
    `UPDATE syntra.jobs
        SET jd_summary = $2, processed_at = now()
      WHERE id = $1`,
    [jobId, summary]
  );
}

async function saveJobExtraction(jobId, requiredSkills, primaryRole, summaryHash) {
  await pool.query(
    `UPDATE syntra.jobs
        SET required_skills = $2::jsonb,
            primary_role = $3,
            summary_hash = $4
      WHERE id = $1`,
    [jobId, JSON.stringify(requiredSkills), primaryRole, summaryHash]
  );
}

async function markJobFailed(jobId, error) {
  await pool.query(
    `UPDATE syntra.jobs
        SET processing_failed_at = now(), processing_error = $2
      WHERE id = $1`,
    [jobId, error]
  );
}

// Resume Repositories
async function getResume(resumeId) {
  const { rows } = await pool.query(
    "SELECT id, candidate_id, file_path, resume_summary FROM syntra.resumes WHERE id = $1",
    [resumeId]
  );
  return rows[0];
}

async function markResumeProcessing(resumeId) {
  await pool.query(
    `UPDATE syntra.resumes
        SET processing_started_at = now(),
            processing_failed_at = NULL,
            processing_error = NULL
      WHERE id = $1`,
    [resumeId]
  );
}

async function saveResumeSummary(resumeId, summary) {
  await pool.query(
    `UPDATE syntra.resumes
        SET resume_summary = $2,
            processed_at = now(),
            processing_failed_at = NULL,
            processing_error = NULL
      WHERE id = $1`,
    [resumeId, summary]
  );
}

async function saveResumeExtraction(resumeId, skills, primaryRole, summaryHash) {
  await pool.query(
    `UPDATE syntra.resumes
        SET skills = $2::jsonb,
            primary_role = $3,
            summary_hash = $4
      WHERE id = $1`,
    [resumeId, JSON.stringify(skills), primaryRole, summaryHash]
  );
}

async function saveProfile(resumeId, profileData) {
  const {
    min_rate = "",
    education = [],
    experience = [],
    total_experience = "",
    current_company = "",
    current_role = "",
    profile_summary = "",
  } = profileData;

  await pool.query(
    `UPDATE syntra.resumes SET
        min_rate = NULLIF(btrim($2), ''),
        education = $3::jsonb,
        experience = $4::jsonb,
        total_experience = NULLIF(btrim($5), ''),
        current_company = NULLIF(btrim($6), ''),
        "current_role" = NULLIF(btrim($7), ''),
        profile_summary = NULLIF(btrim($8), ''),
        updated_at = now()
      WHERE id = $1`,
    [
      resumeId,
      min_rate,
      JSON.stringify(education),
      JSON.stringify(experience),
      total_experience,
      current_company,
      current_role,
      profile_summary,
    ]
  );
}

async function markResumeFailed(resumeId, error) {
  await pool.query(
    `UPDATE syntra.resumes
        SET processing_failed_at = now(), processing_error = $2
      WHERE id = $1`,
    [resumeId, error]
  );
}

// Match Repositories
async function markMatching(jobId, resumeId) {
  await pool.query(
    `UPDATE syntra.matches
        SET match_status = 'processing', matching_started_at = now()
      WHERE job_id = $1 AND resume_id = $2`,
    [jobId, resumeId]
  );
}

async function markMatchFailed(jobId, resumeId, error) {
  await pool.query(
    `UPDATE syntra.matches
        SET match_status = 'failed',
            matching_failed_at = now(),
            matching_error = $3
      WHERE job_id = $1 AND resume_id = $2`,
    [jobId, resumeId, error]
  );
}

module.exports = {
  getJob,
  markJobProcessing,
  saveJobSummary,
  saveJobExtraction,
  markJobFailed,
  getResume,
  markResumeProcessing,
  saveResumeSummary,
  saveResumeExtraction,
  saveProfile,
  markResumeFailed,
  markMatching,
  markMatchFailed,
};
