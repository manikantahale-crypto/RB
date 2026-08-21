const { pool } = require("../config/db");

async function insertJob(
  client,
  { title, originalFileName, filePath, mimeType, rawText, createdBy }
) {
  const sql = `
    INSERT INTO syntra.jobs (title, original_file_name, file_path, mime_type, raw_text, uploaded_at, score_threshold, created_by, status)
    VALUES ($1, $2, $3, $4, $5, now(), 50, $6, 'Staging')
    RETURNING id, title, original_file_name, file_path, uploaded_at, created_by
  `;
  const { rows } = await client.query(sql, [
    title || null,
    originalFileName,
    filePath,
    mimeType || null,
    rawText,
    createdBy || null,
  ]);
  return rows[0];
}

async function getJobById(jobId, userId = null) {
  const params = [jobId];
  let extraWhere = "";
  if (userId) {
    params.push(userId);
    extraWhere = " AND created_by = $2";
  }

  const { rows } = await pool.query(
    `SELECT id, title, original_file_name, file_path, mime_type, raw_text,
            jd_summary, required_skills, primary_role, summary_hash,
            score_threshold, uploaded_at, processed_at, processing_failed_at,
            processing_status, processing_error, embedding,
            COALESCE(status, 'Active') AS status,
            location, created_by,
            company_name, source_email, source_url, message_id,
            employment_type, visa_requirement, remote_policy,
            min_experience, max_experience
       FROM syntra.jobs
      WHERE id = $1${extraWhere}`,
    params
  );
  return rows[0] || null;
}

async function markProcessing(jobId) {
  await pool.query(
    `UPDATE syntra.jobs
        SET processing_started_at = now(),
            processing_failed_at = NULL,
            processing_error = NULL
      WHERE id = $1`,
    [jobId]
  );
}

async function saveAiResult(
  jobId,
  { summary, skills, primaryRole, summaryHash }
) {
  await pool.query(
    `UPDATE syntra.jobs
        SET jd_summary = $2,
            required_skills = $3::jsonb,
            primary_role = $4,
            summary_hash = $5,
            processed_at = now(),
            processing_status = 'processed',
            processing_failed_at = NULL,
            processing_error = NULL
      WHERE id = $1`,
    [jobId, summary, JSON.stringify(skills || []), primaryRole || "other", summaryHash]
  );
}

async function saveAiResultAndEmbedding(
  jobId,
  { summary, skills, primaryRole, summaryHash, embedding, embeddingModel, embeddingVersion }
) {
  const vectorStr = embedding && Array.isArray(embedding) ? `[${embedding.join(",")}]` : null;
  await pool.query(
    `UPDATE syntra.jobs
        SET jd_summary = $2,
            required_skills = $3::jsonb,
            primary_role = $4,
            summary_hash = $5,
            embedding = $6::vector,
            embedding_model = $7,
            embedding_version = $8,
            processed_at = now(),
            processing_status = 'processed',
            processing_failed_at = NULL,
            processing_error = NULL
      WHERE id = $1`,
    [jobId, summary, JSON.stringify(skills || []), primaryRole || "other", summaryHash, vectorStr, embeddingModel || "text-embedding-3-small", embeddingVersion || "v1"]
  );
}

async function markFailed(jobId, error) {
  await pool.query(
    `UPDATE syntra.jobs
        SET processing_failed_at = now(),
        processing_status = 'failed',
        processing_error = $2
      WHERE id = $1`,
    [jobId, String(error).slice(0, 2000)]
  );
}

async function listJobs({ userId = null, limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const whereClause = userId
    ? "WHERE j.created_by = $1 AND j.created_by IS NOT NULL AND j.processed_at IS NOT NULL AND j.processing_failed_at IS NULL AND j.status = 'Active'"
    : "WHERE j.created_by IS NOT NULL AND j.processed_at IS NOT NULL AND j.processing_failed_at IS NULL AND j.status = 'Active'";
  const countWhere = userId
    ? "WHERE created_by = $1 AND created_by IS NOT NULL AND processed_at IS NOT NULL AND processing_failed_at IS NULL AND status = 'Active'"
    : "WHERE created_by IS NOT NULL AND processed_at IS NOT NULL AND processing_failed_at IS NULL AND status = 'Active'";
  const queryParams = userId ? [userId, safeLimit] : [safeLimit];
  const countParams = userId ? [userId] : [];

  const listSql = `
    SELECT j.id,
           j.title,
           j.original_file_name,
           j.primary_role,
           j.required_skills,
           j.uploaded_at,
           j.processed_at,
           j.processing_failed_at,
           j.processing_error,
           COALESCE(j.status, 'Active') AS status,
           j.score_threshold,
           j.location,
           j.created_by,
           j.company_name,
           j.source_email,
           j.source_url,
           j.message_id,
           j.employment_type,
           j.visa_requirement,
           j.remote_policy,
           j.min_experience,
           j.max_experience,
           j.processing_status,
           COALESCE(mc.match_count, 0)::int AS match_count,
           mc.match_scores
      FROM syntra.jobs j
      LEFT JOIN LATERAL (
        SELECT 
          COUNT(*)::int AS match_count,
          COALESCE(
            json_agg(
              GREATEST(COALESCE(m.score, 0), COALESCE(m.skill_match_score, 0))
            ), 
            '[]'::json
          ) AS match_scores
          FROM syntra.matches m
         WHERE m.job_id = j.id
      ) mc ON true
     ${whereClause}
     ORDER BY j.uploaded_at DESC NULLS LAST
     LIMIT $${queryParams.length}`;

  const countSql = `SELECT COUNT(*)::int AS total FROM syntra.jobs ${countWhere}`;

  const [listResult, countResult] = await Promise.all([
    pool.query(listSql, queryParams),
    pool.query(countSql, countParams),
  ]);
  return {
    rows: listResult.rows,
    total: countResult.rows[0]?.total ?? 0,
  };
}

async function updateJobThreshold(jobId, threshold) {
  const safeThreshold = Math.min(Math.max(Number(threshold) || 0, 0), 100);
  await pool.query(
    `UPDATE syntra.jobs SET score_threshold = $2 WHERE id = $1`,
    [jobId, safeThreshold]
  );
}

async function deleteJob(jobId, userId = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const checkSql = userId
      ? `SELECT id FROM syntra.jobs WHERE id = $1 AND created_by = $2`
      : `SELECT id FROM syntra.jobs WHERE id = $1`;
    const checkParams = userId ? [jobId, userId] : [jobId];
    const existing = await client.query(checkSql, checkParams);
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(`DELETE FROM syntra.matches WHERE job_id = $1`, [jobId]);
    await client.query(`DELETE FROM syntra.jobs WHERE id = $1`, [jobId]);
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function deleteJobs(jobIds, userId = null) {
  const ids = Array.isArray(jobIds) ? jobIds.filter(Boolean) : [];
  if (ids.length === 0) return { deleted: 0 };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const selectSql = userId
      ? `SELECT id FROM syntra.jobs WHERE id = ANY($1::uuid[]) AND created_by = $2`
      : `SELECT id FROM syntra.jobs WHERE id = ANY($1::uuid[])`;
    const selectParams = userId ? [ids, userId] : [ids];
    const ownedRows = await client.query(selectSql, selectParams);
    const ownedIds = ownedRows.rows.map(r => r.id);
    if (ownedIds.length === 0) {
      await client.query("ROLLBACK");
      return { deleted: 0 };
    }
    await client.query(`DELETE FROM syntra.matches WHERE job_id = ANY($1::uuid[])`, [ownedIds]);
    const { rowCount } = await client.query(
      `DELETE FROM syntra.jobs WHERE id = ANY($1::uuid[])`,
      [ownedIds]
    );
    await client.query("COMMIT");
    return { deleted: rowCount || 0 };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function saveEmbedding(jobId, embedding, model, version, hash) {
  await pool.query(
    `UPDATE syntra.jobs
        SET embedding = $2::vector,
            embedding_model = $3,
            embedding_version = $4,
            summary_hash = $5
      WHERE id = $1`,
    [jobId, `[${embedding.join(",")}]`, model, version, hash]
  );
}

async function getClosestResumesCount(jobId, threshold = 60, userId = null) {
  const safeThreshold = Math.min(Math.max(Number(threshold) || 0, 0), 100);
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM syntra.matches
      WHERE job_id = $1
        AND COALESCE(score, skill_match_score, 0) >= $2`,
    [jobId, safeThreshold]
  );
  return rows[0]?.count ?? 0;
}

async function saveJobsBulk(jobIds, userId) {
  if (!jobIds || jobIds.length === 0) return 0;
  
  const params = [jobIds];
  let userCondition = "";
  if (userId) {
    params.push(userId);
    userCondition = " AND created_by = $2";
  }

  const { rowCount } = await pool.query(
    `UPDATE syntra.jobs
        SET status = 'Active'
      WHERE id = ANY($1)
        AND processed_at IS NOT NULL
        AND processing_failed_at IS NULL
        ${userCondition}`,
    params
  );
  return rowCount;
}

async function resetProcessingState(jobId) {
  const { rowCount } = await pool.query(
    `UPDATE syntra.jobs
        SET processing_failed_at = NULL,
            processing_error = NULL,
            processing_started_at = NULL,
            status = 'Staging'
      WHERE id = $1 AND processing_failed_at IS NOT NULL`,
    [jobId]
  );
  return rowCount;
}

module.exports = {
  insertJob,
  getJobById,
  markProcessing,
  saveAiResult,
  saveAiResultAndEmbedding,
  markFailed,
  listJobs,
  updateJobThreshold,
  deleteJob,
  deleteJobs,
  saveEmbedding,
  getClosestResumesCount,
  saveJobsBulk,
  resetProcessingState,
};
