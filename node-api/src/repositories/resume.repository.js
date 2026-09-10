const { pool } = require("../config/db");
const {
  CORE_MATCHES,
  CORE_PEOPLE,
  CORE_REQUIREMENTS,
  CORE_RESUMES,
} = require("./core-views");
const {
  setProcessing,
  setEmbedding,
  setContentHash,
  addSourceFile,
} = require("./core-writes");
const { withTransaction } = require("../config/db");

async function insertResume(
  client,
  { candidateId, originalFileName, filePath, mimeType, rawText }
) {
  const sql = `
    INSERT INTO core.resumes
      (person_id, version_number, is_current, uploaded_at)
    VALUES ($1, 1, true, now())
    RETURNING id, person_id AS candidate_id, version_number, is_current, uploaded_at
  `;
  // Only the person is a parameter now. The file's details are not columns on
  // this row any more; they are passed to addSourceFile below.
  const { rows } = await client.query(sql, [candidateId]);

  const resume = rows[0];

  // The document is a row of its own now. A resume without one is possible —
  // core.source_files exists only where there is a file — so the caller's
  // shape is preserved explicitly rather than read back.
  await addSourceFile(client, {
    subjectType: "resume",
    subjectId: resume.id,
    originalFileName,
    filePath,
    mimeType,
    rawText,
  });

  return { ...resume, file_path: filePath ?? null };
}

async function getResumeById(resumeId) {
  const { rows } = await pool.query(
    `SELECT id, candidate_id, file_path, mime_type, raw_text,
            resume_summary, skills, primary_role, summary_hash,
            processed_at, processing_failed_at, processing_status, processing_error,
            embedding, is_current
       FROM ${CORE_RESUMES}
      WHERE id = $1`,
    [resumeId]
  );
  return rows[0] || null;
}

async function markProcessing(resumeId) {
  await setProcessing(pool, {
    subjectType: "resume",
    subjectId: resumeId,
    status: "running",
    startedAt: new Date(),
    error: null,
  });
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
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE core.resumes
          SET summary = $2,
              skills = $3::jsonb,
              primary_role = $4,
              min_rate = NULLIF(btrim($5), ''),
              education = $6::jsonb,
              experience = $7::jsonb,
              total_experience = NULLIF(btrim($8), ''),
              current_company = NULLIF(btrim($9), ''),
              current_role_title = NULLIF(btrim($10), ''),
              profile_summary = NULLIF(btrim($11), ''),
              updated_at = now()
        WHERE id = $1`,
      [
        resumeId, summary, JSON.stringify(skills || []), primaryRole || "other",
        minRate || "", JSON.stringify(education || []),
        JSON.stringify(experience || []), totalExperience || "",
        currentCompany || "", currentRole || "", profileSummary || "",
      ],
    );
    await setContentHash(client, {
      subjectType: "resume", subjectId: resumeId, hash: summaryHash,
    });
    await setProcessing(client, {
      subjectType: "resume", subjectId: resumeId,
      status: "succeeded", finishedAt: new Date(), error: null,
    });
  });
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
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE core.resumes
          SET summary = $2,
              skills = $3::jsonb,
              primary_role = $4,
              min_rate = NULLIF(btrim($5), ''),
              education = $6::jsonb,
              experience = $7::jsonb,
              total_experience = NULLIF(btrim($8), ''),
              current_company = NULLIF(btrim($9), ''),
              current_role_title = NULLIF(btrim($10), ''),
              profile_summary = NULLIF(btrim($11), ''),
              updated_at = now()
        WHERE id = $1`,
      [
        resumeId, summary, JSON.stringify(skills || []), primaryRole || "other",
        minRate || "", JSON.stringify(education || []),
        JSON.stringify(experience || []), totalExperience || "",
        currentCompany || "", currentRole || "", profileSummary || "",
      ],
    );
    await setContentHash(client, {
      subjectType: "resume", subjectId: resumeId, hash: summaryHash,
    });
    await setEmbedding(client, {
      subjectType: "resume", subjectId: resumeId,
      embedding: embedding && Array.isArray(embedding) ? `[${embedding.join(",")}]` : null,
      model: embeddingModel || "text-embedding-3-small",
      modelVersion: embeddingVersion || "v1",
    });
    await setProcessing(client, {
      subjectType: "resume", subjectId: resumeId,
      status: "succeeded", finishedAt: new Date(), error: null,
    });
  });
}

async function markFailed(resumeId, error) {
  await setProcessing(pool, {
    subjectType: "resume",
    subjectId: resumeId,
    status: "failed",
    failedAt: new Date(),
    error: String(error).slice(0, 2000),
  });
}

async function saveEmbedding(resumeId, embedding, model, version, hash) {
  await withTransaction(async (client) => {
    await setEmbedding(client, {
      subjectType: "resume", subjectId: resumeId,
      embedding: `[${embedding.join(",")}]`, model, modelVersion: version,
    });
    await setContentHash(client, {
      subjectType: "resume", subjectId: resumeId, hash,
    });
  });
}

async function getResumeWithCandidate(resumeId, userId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.candidate_id, r.file_path, r.processing_status
     FROM ${CORE_RESUMES} r
     JOIN ${CORE_PEOPLE} c ON r.candidate_id = c.id
     WHERE r.id = $1 AND (c.created_by = $2 OR c.created_by IS NULL)`,
    [resumeId, userId]
  );
  return rows[0] || null;
}
async function resetProcessingState(resumeId) {
  const { rowCount } = await pool.query(
    // Every column this used to clear now lives on the processing record.
    // Clearing them there is the same act; the resume row itself never held
    // the state, it just carried the columns.
    `UPDATE core.processing_jobs
        SET failed_at = NULL, error = NULL, started_at = NULL,
            finished_at = NULL, status = 'pending'
      WHERE subject_type = 'resume' AND subject_id = $1
        AND stage = 'extract' AND status = 'failed'`,
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
