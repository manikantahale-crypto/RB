const { pool } = require("../config/db");
const {
  CORE_MATCHES,
  CORE_PEOPLE,
  CORE_REQUIREMENTS,
  CORE_RESUMES,
} = require("./core-views");
const { setProcessing, setContentHash } = require("./core-writes");
const { withTransaction } = require("../config/db");

// Job Repositories
async function getJob(jobId) {
  const { rows } = await pool.query(
    `SELECT id, file_path, jd_summary FROM ${CORE_REQUIREMENTS} WHERE id = $1`,
    [jobId]
  );
  return rows[0];
}

async function markJobProcessing(jobId) {
  await setProcessing(pool, {
    subjectType: "requirement", subjectId: jobId,
    status: "running", startedAt: new Date(),
  });
}

async function saveJobSummary(jobId, summary) {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE core.requirements SET summary = $2, updated_at = now() WHERE id = $1`,
      [jobId, summary],
    );
    await setProcessing(client, {
      subjectType: "requirement", subjectId: jobId,
      status: "succeeded", finishedAt: new Date(),
    });
  });
}

async function saveJobExtraction(jobId, requiredSkills, primaryRole, summaryHash) {
  await pool.query(
    `UPDATE core.requirements
        SET required_skills = $2::jsonb, primary_role = $3, updated_at = now()
      WHERE id = $1`,
    [jobId, JSON.stringify(requiredSkills), primaryRole]
  );
  // The hash describes the document, not the requirement.
  await setContentHash(pool, {
    subjectType: "requirement", subjectId: jobId, hash: summaryHash,
  });
}

async function markJobFailed(jobId, error) {
  await setProcessing(pool, {
    subjectType: "requirement", subjectId: jobId,
    status: "failed", failedAt: new Date(), error,
  });
}

// Resume Repositories
async function getResume(resumeId) {
  const { rows } = await pool.query(
    `SELECT id, candidate_id, file_path, resume_summary FROM ${CORE_RESUMES} WHERE id = $1`,
    [resumeId]
  );
  return rows[0];
}

async function markResumeProcessing(resumeId) {
  await setProcessing(pool, {
    subjectType: "resume", subjectId: resumeId,
    status: "running", startedAt: new Date(), error: null,
  });
}

async function saveResumeSummary(resumeId, summary) {
  await pool.query(
    `UPDATE core.resumes SET summary = $2, updated_at = now() WHERE id = $1`,
    [resumeId, summary]
  );
}

async function saveResumeExtraction(resumeId, skills, primaryRole, summaryHash) {
  await pool.query(
    `UPDATE core.resumes
        SET skills = $2::jsonb, primary_role = $3, updated_at = now()
      WHERE id = $1`,
    [resumeId, JSON.stringify(skills), primaryRole]
  );
  await setContentHash(pool, {
    subjectType: "resume", subjectId: resumeId, hash: summaryHash,
  });
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
    `UPDATE core.resumes SET
        min_rate = NULLIF(btrim($2), ''),
        education = $3::jsonb,
        experience = $4::jsonb,
        total_experience = NULLIF(btrim($5), ''),
        current_company = NULLIF(btrim($6), ''),
        current_role_title = NULLIF(btrim($7), ''),
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
  await setProcessing(pool, {
    subjectType: "resume", subjectId: resumeId,
    status: "failed", failedAt: new Date(), error,
  });
}

// Match Repositories
async function markMatching(jobId, resumeId) {
  const { rows } = await pool.query(
    `UPDATE core.matches SET status = 'processing', updated_at = now()
      WHERE requirement_id = $1 AND resume_id = $2 RETURNING id`,
    [jobId, resumeId]
  );
  if (rows[0]) {
    await setProcessing(pool, {
      subjectType: "match", subjectId: rows[0].id, stage: "score",
      status: "running", startedAt: new Date(),
    });
  }
}

async function markMatchFailed(jobId, resumeId, error) {
  const { rows } = await pool.query(
    `UPDATE core.matches SET status = 'failed', updated_at = now()
      WHERE requirement_id = $1 AND resume_id = $2 RETURNING id`,
    [jobId, resumeId]
  );
  if (rows[0]) {
    await setProcessing(pool, {
      subjectType: "match", subjectId: rows[0].id, stage: "score",
      status: "failed", failedAt: new Date(), error,
    });
  }
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
