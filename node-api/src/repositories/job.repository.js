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

async function insertJob(
  client,
  { title, originalFileName, filePath, mimeType, rawText, createdBy, orgId }
) {
  // See insertCandidate: explicit when the session knows it, derived by the
  // trigger when it does not.
  // The requirement first. The file is a separate row, because most
  // requirements arrive as email and have none — 2,690 of 2,946 today.
  const { rows } = await client.query(
    `INSERT INTO core.requirements
       (title, uploaded_at, score_threshold, created_by, org_id, status, origin)
     VALUES ($1, now(), 50, $2, $3, 'Staging', 'manual')
     RETURNING id, title, uploaded_at, created_by, org_id`,
    [title || null, createdBy || null, orgId || null],
  );
  const job = rows[0];

  await addSourceFile(client, {
    subjectType: "requirement",
    subjectId: job.id,
    originalFileName,
    filePath,
    mimeType,
    rawText,
  });

  // The caller's response shape is unchanged: these two came off the wide row.
  return { ...job, original_file_name: originalFileName ?? null, file_path: filePath ?? null };
}

/**
 * A caller inside a transaction may pass its client first — PRISM's workflow
 * does, eleven times, so its reads see its own uncommitted rows. The old
 * project's repositories took that leading client; the port dropped it, and
 * every PRISM consent YES then sent the pg client object as the candidate
 * id ("invalid input syntax for type uuid: {…connectionParameters…}").
 * Found by node-api/scripts/prove-stage5-live.js on 2026-09-21.
 */
function splitClient(args) {
  return args[0] && typeof args[0].query === "function" ? { db: args[0], rest: args.slice(1) } : { db: pool, rest: args };
}

async function getJobById(...args) {
  const { db, rest } = splitClient(args);
  const [jobId, userId = null] = rest;
  const params = [jobId];
  let extraWhere = "";
  if (userId) {
    params.push(userId);
    extraWhere = " AND created_by = $2";
  }

  const { rows } = await db.query(
    `SELECT id, title, original_file_name, file_path, mime_type, raw_text,
            jd_summary, required_skills, primary_role, summary_hash,
            score_threshold, uploaded_at, processed_at, processing_failed_at,
            processing_status, processing_error, embedding,
            COALESCE(status, 'Active') AS status,
            location, created_by,
            company_name, source_email, source_url, message_id,
            employment_type, visa_requirement, remote_policy,
            min_experience, max_experience
       FROM ${CORE_REQUIREMENTS}
      WHERE id = $1${extraWhere}`,
    params
  );
  return rows[0] || null;
}

async function markProcessing(jobId) {
  // Starting an attempt clears the previous failure: the row records the
  // attempt in flight, not a history of every one. Passing null for failedAt
  // is not enough — the helper only overwrites a timestamp when given one — so
  // the status carries the meaning.
  await setProcessing(pool, {
    subjectType: "requirement",
    subjectId: jobId,
    status: "running",
    startedAt: new Date(),
    error: null,
  });
}

async function saveAiResult(
  jobId,
  { summary, skills, primaryRole, summaryHash, mandatorySkills, preferredSkills }
) {
  // One statement became three tables. They go in one transaction because a
  // requirement that says "processed" while its summary is missing is worse
  // than one that says nothing.
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE core.requirements
          SET summary = $2, required_skills = $3::jsonb, primary_role = $4,
              mandatory_skills = $5::jsonb, preferred_skills = $6::jsonb,
              updated_at = now()
        WHERE id = $1`,
      [jobId, summary, JSON.stringify(skills || []), primaryRole || "other",
       JSON.stringify(mandatorySkills || []), JSON.stringify(preferredSkills || [])],
    );
    await setContentHash(client, {
      subjectType: "requirement", subjectId: jobId, hash: summaryHash,
    });
    await setProcessing(client, {
      subjectType: "requirement", subjectId: jobId,
      status: "succeeded", finishedAt: new Date(), error: null,
    });
  });
}

async function saveAiResultAndEmbedding(
  jobId,
  { summary, skills, primaryRole, summaryHash, embedding, embeddingModel, embeddingVersion, mandatorySkills, preferredSkills }
) {
  const vectorStr = embedding && Array.isArray(embedding) ? `[${embedding.join(",")}]` : null;

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE core.requirements
          SET summary = $2, required_skills = $3::jsonb, primary_role = $4,
              mandatory_skills = $5::jsonb, preferred_skills = $6::jsonb,
              updated_at = now()
        WHERE id = $1`,
      [jobId, summary, JSON.stringify(skills || []), primaryRole || "other",
       JSON.stringify(mandatorySkills || []), JSON.stringify(preferredSkills || [])],
    );
    await setContentHash(client, {
      subjectType: "requirement", subjectId: jobId, hash: summaryHash,
    });
    // Versioned by model, so a re-embed adds a row instead of overwriting the
    // vector the previous model produced.
    await setEmbedding(client, {
      subjectType: "requirement", subjectId: jobId, embedding: vectorStr,
      model: embeddingModel || "text-embedding-3-small",
      modelVersion: embeddingVersion || "v1",
    });
    await setProcessing(client, {
      subjectType: "requirement", subjectId: jobId,
      status: "succeeded", finishedAt: new Date(), error: null,
    });
  });
}

async function markFailed(jobId, error) {
  await setProcessing(pool, {
    subjectType: "requirement",
    subjectId: jobId,
    status: "failed",
    failedAt: new Date(),
    error: String(error).slice(0, 2000),
  });
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
      FROM ${CORE_REQUIREMENTS} j
      LEFT JOIN LATERAL (
        SELECT 
          COUNT(*)::int AS match_count,
          COALESCE(
            json_agg(
              GREATEST(COALESCE(m.score, 0), COALESCE(m.skill_match_score, 0))
            ), 
            '[]'::json
          ) AS match_scores
          FROM ${CORE_MATCHES} m
         WHERE m.job_id = j.id
      ) mc ON true
     ${whereClause}
     ORDER BY j.uploaded_at DESC NULLS LAST
     LIMIT $${queryParams.length}`;

  const countSql = `SELECT COUNT(*)::int AS total FROM ${CORE_REQUIREMENTS} ${countWhere}`;

  const listResult = await pool.query(listSql, queryParams);
  const countResult = await pool.query(countSql, countParams);
  return {
    rows: listResult.rows,
    total: countResult.rows[0]?.total ?? 0,
  };
}

async function updateJobThreshold(jobId, threshold) {
  const safeThreshold = Math.min(Math.max(Number(threshold) || 0, 0), 100);
  await pool.query(
    `UPDATE core.requirements SET score_threshold = $2, updated_at = now() WHERE id = $1`,
    [jobId, safeThreshold]
  );
}

async function deleteJob(jobId, userId = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const checkSql = userId
      ? `SELECT id FROM ${CORE_REQUIREMENTS} WHERE id = $1 AND created_by = $2`
      : `SELECT id FROM ${CORE_REQUIREMENTS} WHERE id = $1`;
    const checkParams = userId ? [jobId, userId] : [jobId];
    const existing = await client.query(checkSql, checkParams);
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(`DELETE FROM ${CORE_MATCHES} WHERE job_id = $1`, [jobId]);
    await client.query(`DELETE FROM ${CORE_REQUIREMENTS} WHERE id = $1`, [jobId]);
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
      ? `SELECT id FROM ${CORE_REQUIREMENTS} WHERE id = ANY($1::uuid[]) AND created_by = $2`
      : `SELECT id FROM ${CORE_REQUIREMENTS} WHERE id = ANY($1::uuid[])`;
    const selectParams = userId ? [ids, userId] : [ids];
    const ownedRows = await client.query(selectSql, selectParams);
    const ownedIds = ownedRows.rows.map(r => r.id);
    if (ownedIds.length === 0) {
      await client.query("ROLLBACK");
      return { deleted: 0 };
    }
    await client.query(`DELETE FROM ${CORE_MATCHES} WHERE job_id = ANY($1::uuid[])`, [ownedIds]);
    const { rowCount } = await client.query(
      `DELETE FROM ${CORE_REQUIREMENTS} WHERE id = ANY($1::uuid[])`,
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
  await withTransaction(async (client) => {
    await setEmbedding(client, {
      subjectType: "requirement",
      subjectId: jobId,
      embedding: `[${embedding.join(",")}]`,
      model,
      modelVersion: version,
    });
    await setContentHash(client, {
      subjectType: "requirement", subjectId: jobId, hash,
    });
  });
}

async function getClosestResumesCount(jobId, threshold = 60, userId = null) {
  const safeThreshold = Math.min(Math.max(Number(threshold) || 0, 0), 100);
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM ${CORE_MATCHES}
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
    `UPDATE core.requirements q
        SET status = 'Active', updated_at = now()
      WHERE q.id = ANY($1)
        -- "Processed and not failed" is no longer two columns on this row; it
        -- is what the extract stage recorded.
        AND EXISTS (
          SELECT 1 FROM core.processing_jobs p
           WHERE p.subject_type = 'requirement' AND p.subject_id = q.id
             AND p.stage = 'extract'
             AND p.finished_at IS NOT NULL AND p.failed_at IS NULL)
        ${userCondition}`,
    params
  );
  return rowCount;
}

async function resetProcessingState(jobId) {
  const { rowCount } = await pool.query(
    `WITH cleared AS (
       UPDATE core.processing_jobs
          SET failed_at = NULL, error = NULL, started_at = NULL, status = 'pending'
        WHERE subject_type = 'requirement' AND subject_id = $1
          AND stage = 'extract' AND failed_at IS NOT NULL
       RETURNING subject_id)
     UPDATE core.requirements
        SET status = 'Staging', updated_at = now()
      WHERE id IN (SELECT subject_id FROM cleared)`,
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
