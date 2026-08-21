const { pool } = require("../config/db");

async function insertResume(
  client,
  { candidateId, originalFileName, filePath, mimeType, rawText }
) {
  const sql = `
    INSERT INTO syntra.resumes
      (candidate_id, original_file_name, file_path, mime_type, raw_text,
       version_number, is_current, uploaded_at)
    VALUES ($1, $2, $3, $4, $5, 1, true, now())
    RETURNING id, candidate_id, file_path, version_number, is_current, uploaded_at
  `;
  const { rows } = await client.query(sql, [
    candidateId,
    originalFileName,
    filePath,
    mimeType || null,
    rawText,
  ]);
  return rows[0];
}

async function getResumeById(resumeId) {
  const { rows } = await pool.query(
    `SELECT id, candidate_id, file_path, mime_type, raw_text,
            resume_summary, skills, primary_role, summary_hash,
            processed_at, processing_failed_at, processing_status, processing_error,
            embedding, is_current
       FROM syntra.resumes
      WHERE id = $1`,
    [resumeId]
  );
  return rows[0] || null;
}

async function markProcessing(resumeId) {
  await pool.query(
    `UPDATE syntra.resumes
        SET processing_started_at = now(),
            processing_failed_at = NULL,
            processing_error = NULL
      WHERE id = $1`,
    [resumeId]
  );
}

async function saveAiResult(
  resumeId,
  {
    summary,
    skills,
    primaryRole,
    summaryHash,
    minRate,
    education,
    experience,
    totalExperience,
    currentCompany,
    currentRole,
    profileSummary,
  }
) {
  await pool.query(
    `UPDATE syntra.resumes
        SET resume_summary = $2,
            skills = $3::jsonb,
            primary_role = $4,
            summary_hash = $5,
            min_rate = NULLIF(btrim($6), ''),
            education = $7::jsonb,
            experience = $8::jsonb,
            total_experience = NULLIF(btrim($9), ''),
            current_company = NULLIF(btrim($10), ''),
            "current_role" = NULLIF(btrim($11), ''),
            profile_summary = NULLIF(btrim($12), ''),
            processed_at = now(),
            processing_status = 'processed',
            processing_failed_at = NULL,
            processing_error = NULL,
            updated_at = now()
      WHERE id = $1`,
    [
      resumeId,
      summary,
      JSON.stringify(skills || []),
      primaryRole || "other",
      summaryHash,
      minRate || "",
      JSON.stringify(education || []),
      JSON.stringify(experience || []),
      totalExperience || "",
      currentCompany || "",
      currentRole || "",
      profileSummary || "",
    ]
  );
}

async function saveAiResultAndEmbedding(
  resumeId,
  {
    summary,
    skills,
    primaryRole,
    summaryHash,
    minRate,
    education,
    experience,
    totalExperience,
    currentCompany,
    currentRole,
    profileSummary,
    embedding,
    embeddingModel,
    embeddingVersion,
  }
) {
  const vectorStr = embedding && Array.isArray(embedding) ? `[${embedding.join(",")}]` : null;
  await pool.query(
    `UPDATE syntra.resumes
        SET resume_summary = $2,
            skills = $3::jsonb,
            primary_role = $4,
            summary_hash = $5,
            min_rate = NULLIF(btrim($6), ''),
            education = $7::jsonb,
            experience = $8::jsonb,
            total_experience = NULLIF(btrim($9), ''),
            current_company = NULLIF(btrim($10), ''),
            "current_role" = NULLIF(btrim($11), ''),
            profile_summary = NULLIF(btrim($12), ''),
            embedding = $13::vector,
            embedding_model = $14,
            embedding_version = $15,
            processed_at = now(),
            processing_status = 'processed',
            processing_failed_at = NULL,
            processing_error = NULL,
            updated_at = now()
      WHERE id = $1`,
    [
      resumeId,
      summary,
      JSON.stringify(skills || []),
      primaryRole || "other",
      summaryHash,
      minRate || "",
      JSON.stringify(education || []),
      JSON.stringify(experience || []),
      totalExperience || "",
      currentCompany || "",
      currentRole || "",
      profileSummary || "",
      vectorStr,
      embeddingModel || "text-embedding-3-small",
      embeddingVersion || "v1"
    ]
  );
}

async function markFailed(resumeId, error) {
  await pool.query(
    `UPDATE syntra.resumes
        SET processing_failed_at = now(),
            processing_status = 'failed',
            processing_error = $2
      WHERE id = $1`,
    [resumeId, String(error).slice(0, 2000)]
  );
}

async function saveEmbedding(resumeId, embedding, model, version, hash) {
  await pool.query(
    `UPDATE syntra.resumes
        SET embedding = $2::vector,
            embedding_model = $3,
            embedding_version = $4,
            summary_hash = $5
      WHERE id = $1`,
    [resumeId, `[${embedding.join(",")}]`, model, version, hash]
  );
}

async function getResumeWithCandidate(resumeId, userId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.candidate_id, r.file_path, r.processing_status
     FROM syntra.resumes r
     JOIN syntra.candidates c ON r.candidate_id = c.id
     WHERE r.id = $1 AND (c.created_by = $2 OR c.created_by IS NULL)`,
    [resumeId, userId]
  );
  return rows[0] || null;
}
async function resetProcessingState(resumeId) {
  const { rowCount } = await pool.query(
    `UPDATE syntra.resumes
        SET processing_failed_at = NULL,
            processing_error = NULL,
            processing_started_at = NULL,
            processed_at = NULL,
            processing_status = 'uploaded'
      WHERE id = $1 AND processing_status = 'failed'`,
    [resumeId]
  );
  return rowCount;
}

module.exports = {
  insertResume,
  getResumeById,
  markProcessing,
  saveAiResult,
  saveAiResultAndEmbedding,
  markFailed,
  getResumeWithCandidate,
  saveEmbedding,
  resetProcessingState,
};
