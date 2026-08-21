const { pool } = require("../config/db");

async function insertCandidate(client, { fullName, email, phone, createdBy }) {
  const sql = `
    INSERT INTO syntra.candidates (full_name, email, phone, created_by, status)
    VALUES ($1, $2, $3, $4, 'Staging')
    RETURNING id, full_name, created_at, created_by
  `;
  const { rows } = await client.query(sql, [
    fullName || null,
    email || null,
    phone || null,
    createdBy || null,
  ]);
  return rows[0];
}

async function getCandidateWithCurrentResume(candidateId, userId = null) {
  const params = [candidateId];
  let extraWhere = "";
  if (userId) {
    params.push(userId);
    extraWhere = " AND c.created_by = $2";
  }

  const { rows } = await pool.query(
    `SELECT c.id,
            c.full_name,
            c.email,
            c.phone,
            c.immigration_status,
            c.location,
            c.linkedin,
            c.github,
            c.created_at,
            c.created_by,
            COALESCE(c.status, 'Active') AS status,
            r.id AS resume_id,
            r.skills,
            r.primary_role,
            r.summary_hash,
            r.resume_summary,
            r.min_rate,
            r.education,
            r.experience,
            r.total_experience,
            r.current_company,
            r."current_role" AS current_role,
            r.profile_summary,
            r.processed_at AS resume_processed_at,
            r.processing_failed_at AS resume_processing_failed_at,
            r.processing_error AS resume_processing_error,
            r.embedding,
            r.is_current
       FROM syntra.candidates c
       LEFT JOIN syntra.resumes r
         ON r.candidate_id = c.id AND r.is_current = true
      WHERE c.id = $1${extraWhere}`,
    params
  );
  return rows[0] || null;
}

async function listCandidates({ userId = null, limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const whereClause = userId
    ? "WHERE c.created_by = $1 AND c.created_by IS NOT NULL AND r.id IS NOT NULL AND c.status = 'Active'"
    : "WHERE c.created_by IS NOT NULL AND r.id IS NOT NULL AND c.status = 'Active'";
  const countWhere = userId
    ? "WHERE c.created_by = $1 AND c.created_by IS NOT NULL AND r.id IS NOT NULL AND c.status = 'Active'"
    : "WHERE c.created_by IS NOT NULL AND r.id IS NOT NULL AND c.status = 'Active'";
  const queryParams = userId ? [userId, safeLimit] : [safeLimit];
  const countParams = userId ? [userId] : [];

  const listSql = `
    SELECT c.id,
           c.full_name,
           c.email,
           c.phone,
           c.location,
           c.immigration_status,
           c.linkedin,
           c.github,
           c.created_at,
           c.created_by,
           COALESCE(c.status, 'Active') AS status,
           r.id AS resume_id,
           r.current_company,
           r."current_role" AS current_role,
           r.total_experience,
           r.skills,
           r.primary_role,
           r.experience,
           r.education,
           r.min_rate,
           r.profile_summary,
           r.resume_summary,
           r.original_file_name,
           r.processed_at AS resume_processed_at,
           r.processing_failed_at AS resume_processing_failed_at,
           CASE
             WHEN r.processing_failed_at IS NOT NULL THEN 'failed'
             WHEN r.processed_at IS NULL THEN 'processing'
             ELSE 'processed'
           END AS processing_status,
           COALESCE(mc.match_count, 0)::int AS match_count
      FROM syntra.candidates c
      JOIN syntra.resumes r
        ON r.candidate_id = c.id AND r.is_current = true
      LEFT JOIN (
        SELECT candidate_id, COUNT(*)::int AS match_count
          FROM syntra.matches
         GROUP BY candidate_id
      ) mc ON mc.candidate_id = c.id
     ${whereClause}
     ORDER BY c.created_at DESC NULLS LAST
     LIMIT $${queryParams.length}`;

  const countSql = `
    SELECT COUNT(*)::int AS total 
      FROM syntra.candidates c
      JOIN syntra.resumes r
        ON r.candidate_id = c.id AND r.is_current = true
     ${countWhere}`;

  const [listResult, countResult] = await Promise.all([
    pool.query(listSql, queryParams),
    pool.query(countSql, countParams),
  ]);
  return {
    rows: listResult.rows,
    total: countResult.rows[0]?.total ?? 0,
  };
}

async function deleteCandidate(candidateId, userId = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const checkSql = userId
      ? `SELECT id FROM syntra.candidates WHERE id = $1 AND created_by = $2`
      : `SELECT id FROM syntra.candidates WHERE id = $1`;
    const checkParams = userId ? [candidateId, userId] : [candidateId];
    const existing = await client.query(checkSql, checkParams);
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return false;
    }
    const resumes = await client.query(
      `SELECT id FROM syntra.resumes WHERE candidate_id = $1`,
      [candidateId]
    );
    const resumeIds = resumes.rows.map((r) => r.id);
    await client.query(`DELETE FROM syntra.matches WHERE candidate_id = $1`, [candidateId]);
    if (resumeIds.length) {
      await client.query(`DELETE FROM syntra.matches WHERE resume_id = ANY($1::uuid[])`, [
        resumeIds,
      ]);
    }
    await client.query(`DELETE FROM syntra.resumes WHERE candidate_id = $1`, [candidateId]);
    await client.query(`DELETE FROM syntra.candidates WHERE id = $1`, [candidateId]);
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function deleteCandidates(candidateIds, userId = null) {
  const ids = Array.isArray(candidateIds) ? candidateIds.filter(Boolean) : [];
  if (ids.length === 0) return { deleted: 0 };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const selectSql = userId
      ? `SELECT id FROM syntra.candidates WHERE id = ANY($1::uuid[]) AND created_by = $2`
      : `SELECT id FROM syntra.candidates WHERE id = ANY($1::uuid[])`;
    const selectParams = userId ? [ids, userId] : [ids];
    const ownedRows = await client.query(selectSql, selectParams);
    const ownedIds = ownedRows.rows.map((r) => r.id);
    if (ownedIds.length === 0) {
      await client.query("ROLLBACK");
      return { deleted: 0 };
    }
    const resumes = await client.query(
      `SELECT id FROM syntra.resumes WHERE candidate_id = ANY($1::uuid[])`,
      [ownedIds]
    );
    const resumeIds = resumes.rows.map((r) => r.id);
    await client.query(
      `DELETE FROM syntra.matches WHERE candidate_id = ANY($1::uuid[])`,
      [ownedIds]
    );
    if (resumeIds.length) {
      await client.query(`DELETE FROM syntra.matches WHERE resume_id = ANY($1::uuid[])`, [
        resumeIds,
      ]);
    }
    await client.query(`DELETE FROM syntra.resumes WHERE candidate_id = ANY($1::uuid[])`, [
      ownedIds,
    ]);
    const { rowCount } = await client.query(
      `DELETE FROM syntra.candidates WHERE id = ANY($1::uuid[])`,
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

/**
 * Person-level profile fields from AI.
 * full_name / email / phone only fill when currently empty (don't clobber form upload).
 */
async function saveProfileFields(
  candidateId,
  {
    fullName = "",
    email = "",
    phone = "",
    immigrationStatus = "",
    location = "",
    linkedin = "",
    github = "",
  }
) {
  await pool.query(
    `UPDATE syntra.candidates SET
       full_name = CASE
         WHEN btrim($2) <> '' THEN $2
         ELSE full_name
       END,
       email = CASE
         WHEN btrim($3) <> '' THEN $3
         ELSE email
       END,
       phone = CASE
         WHEN btrim($4) <> '' THEN $4
         ELSE phone
       END,
       immigration_status = COALESCE(NULLIF(btrim($5), ''), immigration_status),
       location = COALESCE(NULLIF(btrim($6), ''), location),
       linkedin = COALESCE(NULLIF(btrim($7), ''), linkedin),
       github = COALESCE(NULLIF(btrim($8), ''), github)
     WHERE id = $1`,
    [
      candidateId,
      fullName || "",
      email || "",
      phone || "",
      immigrationStatus || "",
      location || "",
      linkedin || "",
      github || "",
    ]
  );
}

/**
 * Update candidate fields by ID (with optional userId ownership check).
 */
async function updateCandidate(candidateId, updates = {}, userId = null) {
  const allowed = [
    "full_name",
    "email",
    "phone",
    "immigration_status",
    "location",
    "linkedin",
    "github",
    "current_title",
    "status",
  ];

  const setClauses = [];
  const values = [candidateId];
  let idx = 2;

  for (const key of allowed) {
    if (updates[key] !== undefined) {
      setClauses.push(`${key} = $${idx++}`);
      values.push(updates[key]);
    }
  }

  if (setClauses.length === 0) {
    return getCandidateWithCurrentResume(candidateId, userId);
  }

  setClauses.push("updated_at = now()");

  let whereClause = "WHERE id = $1";
  if (userId) {
    whereClause += ` AND (created_by = $${idx++} OR created_by IS NULL)`;
    values.push(userId);
  }

  const sql = `
    UPDATE syntra.candidates
       SET ${setClauses.join(", ")}
     ${whereClause}
     RETURNING id, full_name, email, phone, location, immigration_status, status, updated_at;
  `;
  const { rows } = await pool.query(sql, values);
  return rows[0] || null;
}

async function getClosestJdsCount(candidateId, threshold = 60, userId = null) {
  const safeThreshold = Math.min(Math.max(Number(threshold) || 0, 0), 100);
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM syntra.matches
      WHERE candidate_id = $1
        AND COALESCE(score, skill_match_score, 0) >= $2`,
    [candidateId, safeThreshold]
  );
  return rows[0]?.count ?? 0;
}
async function saveCandidatesBulk(candidateIds, userId) {
  if (!candidateIds || candidateIds.length === 0) return 0;
  
  const params = [candidateIds];
  let userCondition = "";
  if (userId) {
    params.push(userId);
    userCondition = " AND c.created_by = $2";
  }

  const { rowCount } = await pool.query(
    `UPDATE syntra.candidates c
        SET status = 'Active'
       FROM syntra.resumes r
      WHERE r.candidate_id = c.id
        AND c.id = ANY($1)
        AND r.processed_at IS NOT NULL
        AND r.processing_failed_at IS NULL
        ${userCondition}`,
    params
  );
  return rowCount;
}

module.exports = {
  insertCandidate,
  getCandidateWithCurrentResume,
  listCandidates,
  deleteCandidate,
  deleteCandidates,
  saveProfileFields,
  updateCandidate,
  getClosestJdsCount,
  saveCandidatesBulk,
};
