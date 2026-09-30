const { pool } = require("../config/db");
const {
  CORE_MATCHES,
  CORE_PEOPLE,
  CORE_REQUIREMENTS,
  CORE_RESUMES,
} = require("./core-views");

async function insertCandidate(client, { fullName, email, phone, createdBy, orgId }) {
  // org_id is passed explicitly rather than left to the trigger, so the row
  // records the organisation the SESSION was acting for. Null is accepted and
  // the trigger derives it from created_by — see V20260909.13.
  const sql = `
    INSERT INTO core.people (full_name, email, phone, created_by, org_id, status)
    VALUES ($1, $2, $3, $4, $5, 'Staging')
    RETURNING id, full_name, created_at, created_by, org_id
  `;
  const { rows } = await client.query(sql, [
    fullName || null,
    email || null,
    phone || null,
    createdBy || null,
    orgId || null,
  ]);
  return rows[0];
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

async function getCandidateWithCurrentResume(...args) {
  const { db, rest } = splitClient(args);
  const [candidateId, userId = null] = rest;
  const params = [candidateId];
  let extraWhere = "";
  if (userId) {
    params.push(userId);
    extraWhere = " AND (c.created_by = $2 OR c.created_by IS NULL OR c.org_id IN (SELECT org_id FROM platform.org_members WHERE user_id = $2 AND status = 'active'))";
  }

  const { rows } = await db.query(
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
       FROM ${CORE_PEOPLE} c
       LEFT JOIN ${CORE_RESUMES} r
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
      FROM ${CORE_PEOPLE} c
      JOIN ${CORE_RESUMES} r
        ON r.candidate_id = c.id AND r.is_current = true
      LEFT JOIN (
        SELECT candidate_id, COUNT(*)::int AS match_count
          FROM ${CORE_MATCHES}
         GROUP BY candidate_id
      ) mc ON mc.candidate_id = c.id
     ${whereClause}
     ORDER BY c.created_at DESC NULLS LAST
     LIMIT $${queryParams.length}`;

  const countSql = `
    SELECT COUNT(*)::int AS total 
      FROM ${CORE_PEOPLE} c
      JOIN ${CORE_RESUMES} r
        ON r.candidate_id = c.id AND r.is_current = true
     ${countWhere}`;

  const listResult = await pool.query(listSql, queryParams);
  const countResult = await pool.query(countSql, countParams);
  return {
    rows: listResult.rows,
    total: countResult.rows[0]?.total ?? 0,
  };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(val) {
  return typeof val === "string" && UUID_REGEX.test(val);
}

async function deleteCandidate(candidateId, userId = null) {
  if (!isValidUuid(candidateId)) return false;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const checkSql = userId
      ? `SELECT id FROM ${CORE_PEOPLE} WHERE id = $1 AND (created_by = $2 OR created_by IS NULL)`
      : `SELECT id FROM ${CORE_PEOPLE} WHERE id = $1`;
    const checkParams = userId ? [candidateId, userId] : [candidateId];
    const existing = await client.query(checkSql, checkParams);
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return false;
    }

    const resumes = await client.query(
      `SELECT id FROM core.resumes WHERE person_id = $1`,
      [candidateId]
    );
    const resumeIds = resumes.rows.map((r) => r.id);

    // 1. Matches
    await client.query(`DELETE FROM core.matches WHERE person_id = $1`, [candidateId]);
    if (resumeIds.length) {
      await client.query(`DELETE FROM core.matches WHERE resume_id = ANY($1::uuid[])`, [
        resumeIds,
      ]);
    }

    // 2. Activities
    await client.query(`DELETE FROM core.activities WHERE person_id = $1`, [candidateId]);

    // 3. Orbit module records
    await client.query(`DELETE FROM orbit.lifecycle_states WHERE person_id = $1`, [candidateId]);
    await client.query(`DELETE FROM orbit.interviews WHERE person_id = $1`, [candidateId]);
    await client.query(`DELETE FROM orbit.submissions WHERE person_id = $1`, [candidateId]);
    await client.query(`DELETE FROM orbit.placements WHERE person_id = $1`, [candidateId]);

    // 4. Prism module records (approvals, consents, rtr cascade from prism.submissions)
    if (resumeIds.length) {
      await client.query(
        `DELETE FROM prism.submissions WHERE person_id = $1 OR resume_id = ANY($2::uuid[])`,
        [candidateId, resumeIds]
      );
    } else {
      await client.query(`DELETE FROM prism.submissions WHERE person_id = $1`, [candidateId]);
    }

    // 5. Relay module records
    await client.query(`DELETE FROM relay.followups WHERE candidate_id = $1`, [candidateId]);
    await client.query(`DELETE FROM relay.email_classifications WHERE candidate_id = $1`, [candidateId]);
    await client.query(
      `DELETE FROM relay.email_messages WHERE thread_id IN (SELECT thread_id FROM relay.email_threads WHERE candidate_id = $1)`,
      [candidateId]
    );
    await client.query(`DELETE FROM relay.email_threads WHERE candidate_id = $1`, [candidateId]);

    // 6. Syntra scoring log
    await client.query(`DELETE FROM syntra.scoring_log WHERE candidate_id = $1`, [candidateId]);
    if (resumeIds.length) {
      await client.query(`DELETE FROM syntra.scoring_log WHERE resume_id = ANY($1::uuid[])`, [
        resumeIds,
      ]);
    }

    // 7. Polymorphic tables (embeddings, processing_jobs, source_files)
    const subjectIds = [candidateId, ...resumeIds];
    await client.query(
      `DELETE FROM core.embeddings WHERE subject_type IN ('person', 'resume') AND subject_id = ANY($1::uuid[])`,
      [subjectIds]
    );
    await client.query(
      `DELETE FROM core.processing_jobs WHERE subject_type IN ('person', 'resume') AND subject_id = ANY($1::uuid[])`,
      [subjectIds]
    );
    await client.query(
      `DELETE FROM core.source_files WHERE subject_type IN ('person', 'resume') AND subject_id = ANY($1::uuid[])`,
      [subjectIds]
    );

    // 8. Resumes
    await client.query(`DELETE FROM core.resumes WHERE person_id = $1`, [candidateId]);

    // 9. People
    await client.query(`DELETE FROM core.people WHERE id = $1`, [candidateId]);

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
  const validIds = ids.filter(isValidUuid);
  if (validIds.length === 0) return { deleted: 0 };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const selectSql = userId
      ? `SELECT id FROM core.people WHERE id = ANY($1::uuid[]) AND (created_by = $2 OR created_by IS NULL)`
      : `SELECT id FROM core.people WHERE id = ANY($1::uuid[])`;
    const selectParams = userId ? [validIds, userId] : [validIds];
    const ownedRows = await client.query(selectSql, selectParams);
    const ownedIds = ownedRows.rows.map((r) => r.id);
    if (ownedIds.length === 0) {
      await client.query("ROLLBACK");
      return { deleted: 0 };
    }

    const resumes = await client.query(
      `SELECT id FROM core.resumes WHERE person_id = ANY($1::uuid[])`,
      [ownedIds]
    );
    const resumeIds = resumes.rows.map((r) => r.id);

    // 1. Matches
    await client.query(
      `DELETE FROM core.matches WHERE person_id = ANY($1::uuid[])`,
      [ownedIds]
    );
    if (resumeIds.length) {
      await client.query(`DELETE FROM core.matches WHERE resume_id = ANY($1::uuid[])`, [
        resumeIds,
      ]);
    }

    // 2. Activities
    await client.query(`DELETE FROM core.activities WHERE person_id = ANY($1::uuid[])`, [ownedIds]);

    // 3. Orbit module records
    await client.query(`DELETE FROM orbit.lifecycle_states WHERE person_id = ANY($1::uuid[])`, [ownedIds]);
    await client.query(`DELETE FROM orbit.interviews WHERE person_id = ANY($1::uuid[])`, [ownedIds]);
    await client.query(`DELETE FROM orbit.submissions WHERE person_id = ANY($1::uuid[])`, [ownedIds]);
    await client.query(`DELETE FROM orbit.placements WHERE person_id = ANY($1::uuid[])`, [ownedIds]);

    // 4. Prism module records
    if (resumeIds.length) {
      await client.query(
        `DELETE FROM prism.submissions WHERE person_id = ANY($1::uuid[]) OR resume_id = ANY($2::uuid[])`,
        [ownedIds, resumeIds]
      );
    } else {
      await client.query(`DELETE FROM prism.submissions WHERE person_id = ANY($1::uuid[])`, [ownedIds]);
    }

    // 5. Relay module records
    await client.query(`DELETE FROM relay.followups WHERE candidate_id = ANY($1::uuid[])`, [ownedIds]);
    await client.query(`DELETE FROM relay.email_classifications WHERE candidate_id = ANY($1::uuid[])`, [ownedIds]);
    await client.query(
      `DELETE FROM relay.email_messages WHERE thread_id IN (SELECT thread_id FROM relay.email_threads WHERE candidate_id = ANY($1::uuid[]))`,
      [ownedIds]
    );
    await client.query(`DELETE FROM relay.email_threads WHERE candidate_id = ANY($1::uuid[])`, [ownedIds]);

    // 6. Syntra scoring log
    await client.query(`DELETE FROM syntra.scoring_log WHERE candidate_id = ANY($1::uuid[])`, [ownedIds]);
    if (resumeIds.length) {
      await client.query(`DELETE FROM syntra.scoring_log WHERE resume_id = ANY($1::uuid[])`, [
        resumeIds,
      ]);
    }

    // 7. Polymorphic tables
    const subjectIds = [...ownedIds, ...resumeIds];
    await client.query(
      `DELETE FROM core.embeddings WHERE subject_type IN ('person', 'resume') AND subject_id = ANY($1::uuid[])`,
      [subjectIds]
    );
    await client.query(
      `DELETE FROM core.processing_jobs WHERE subject_type IN ('person', 'resume') AND subject_id = ANY($1::uuid[])`,
      [subjectIds]
    );
    await client.query(
      `DELETE FROM core.source_files WHERE subject_type IN ('person', 'resume') AND subject_id = ANY($1::uuid[])`,
      [subjectIds]
    );

    // 8. Resumes
    await client.query(`DELETE FROM core.resumes WHERE person_id = ANY($1::uuid[])`, [
      ownedIds,
    ]);

    // 9. People
    const { rowCount } = await client.query(
      `DELETE FROM core.people WHERE id = ANY($1::uuid[])`,
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
    `UPDATE core.people SET
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
 * Updates core.people, core.resumes, and orbit.lifecycle_states safely in a transaction.
 */
async function updateCandidate(candidateId, updates = {}, userId = null) {
  if (!isValidUuid(candidateId)) return null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const checkSql = userId
      ? `SELECT id, org_id FROM core.people WHERE id = $1 AND (created_by = $2 OR created_by IS NULL)`
      : `SELECT id, org_id FROM core.people WHERE id = $1`;
    const checkParams = userId ? [candidateId, userId] : [candidateId];
    const existing = await client.query(checkSql, checkParams);
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    const orgId = existing.rows[0].org_id;

    // 1. Update core.people
    const peopleMap = {
      full_name: updates.full_name !== undefined ? updates.full_name : updates.fullName,
      email: updates.email !== undefined ? updates.email : undefined,
      phone: updates.phone !== undefined ? updates.phone : undefined,
      immigration_status:
        updates.immigration_status !== undefined
          ? updates.immigration_status
          : updates.work_authorization,
      location: updates.location !== undefined ? updates.location : undefined,
      linkedin: updates.linkedin !== undefined ? updates.linkedin : undefined,
      github: updates.github !== undefined ? updates.github : undefined,
      current_title: updates.current_title !== undefined ? updates.current_title : updates.title,
      status: updates.status !== undefined ? updates.status : undefined,
    };

    const setClauses = [];
    const values = [candidateId];
    let idx = 2;

    for (const [col, val] of Object.entries(peopleMap)) {
      if (val !== undefined) {
        setClauses.push(`${col} = $${idx++}`);
        values.push(val);
      }
    }

    if (setClauses.length > 0) {
      setClauses.push("updated_at = now()");
      await client.query(
        `UPDATE core.people SET ${setClauses.join(", ")} WHERE id = $1`,
        values
      );
    }

    // 2. Update core.resumes (current or latest resume)
    const hasResumeUpdates =
      updates.skills !== undefined ||
      updates.total_experience !== undefined ||
      updates.experience_years !== undefined ||
      updates.min_rate !== undefined ||
      updates.minRate !== undefined ||
      updates.current_title !== undefined ||
      updates.title !== undefined;

    if (hasResumeUpdates) {
      const rRes = await client.query(
        `SELECT id FROM core.resumes WHERE person_id = $1 AND is_current = true ORDER BY created_at DESC LIMIT 1`,
        [candidateId]
      );
      let resumeId = rRes.rows[0]?.id;
      if (!resumeId) {
        const anyR = await client.query(
          `SELECT id FROM core.resumes WHERE person_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [candidateId]
        );
        resumeId = anyR.rows[0]?.id;
      }

      if (resumeId) {
        const rClauses = [];
        const rValues = [resumeId];
        let rIdx = 2;

        if (updates.skills !== undefined) {
          let sVal = updates.skills;
          if (typeof sVal === "string") {
            try {
              sVal = JSON.parse(sVal);
            } catch {
              sVal = sVal.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
            }
          }
          if (!Array.isArray(sVal)) sVal = [sVal];
          rClauses.push(`skills = $${rIdx++}`);
          rValues.push(JSON.stringify(sVal));
        }

        const expVal =
          updates.total_experience !== undefined
            ? updates.total_experience
            : updates.experience_years;
        if (expVal !== undefined) {
          rClauses.push(`total_experience = $${rIdx++}`);
          rValues.push(expVal);
          const parsedExp = parseInt(expVal, 10);
          if (!isNaN(parsedExp)) {
            rClauses.push(`years_experience = $${rIdx++}`);
            rValues.push(parsedExp);
          }
        }

        const rateVal = updates.min_rate !== undefined ? updates.min_rate : updates.minRate;
        if (rateVal !== undefined) {
          rClauses.push(`min_rate = $${rIdx++}`);
          rValues.push(rateVal);
        }

        const titleVal =
          updates.current_title !== undefined ? updates.current_title : updates.title;
        if (titleVal !== undefined) {
          rClauses.push(`current_role_title = $${rIdx++}`);
          rValues.push(titleVal);
          rClauses.push(`primary_role = $${rIdx++}`);
          rValues.push(titleVal);
        }

        if (rClauses.length > 0) {
          rClauses.push("updated_at = now()");
          await client.query(
            `UPDATE core.resumes SET ${rClauses.join(", ")} WHERE id = $1`,
            rValues
          );
        }
      }
    }

    // 3. Record lifecycle transition if specified
    const targetState =
      updates.orbit_lifecycle_state ||
      (updates.status === "Active" ? "AVAILABLE" : updates.status);
    if (targetState) {
      await client.query(
        `INSERT INTO orbit.lifecycle_states (org_id, person_id, state, transitioned_by, transitioned_at)
         VALUES ($1, $2, $3, $4, now())`,
        [orgId, candidateId, targetState, userId]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return getCandidateWithCurrentResume(candidateId, userId);
}

async function getClosestJdsCount(candidateId, threshold = 60, userId = null) {
  const safeThreshold = Math.min(Math.max(Number(threshold) || 0, 0), 100);
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM ${CORE_MATCHES}
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
    `UPDATE core.people c
        SET status = 'Active', updated_at = now()
       FROM core.resumes r
      WHERE r.person_id = c.id
        AND c.id = ANY($1)
        -- "Processed and not failed" is what the extract stage recorded, not
        -- two columns on the resume any more.
        AND EXISTS (
          SELECT 1 FROM core.processing_jobs p
           WHERE p.subject_type = 'resume' AND p.subject_id = r.id
             AND p.stage = 'extract'
             AND p.finished_at IS NOT NULL AND p.failed_at IS NULL)
        ${userCondition}`,
    params
  );
  return rowCount;
}

async function getCurrentResumeId(candidateId, userId = null) {
  const params = [candidateId];
  let extra = "";
  if (userId) {
    params.push(userId);
    extra = " AND (c.created_by = $2 OR c.created_by IS NULL OR c.org_id IN (SELECT org_id FROM platform.org_members WHERE user_id = $2 AND status = 'active'))";
  }
  const { rows } = await pool.query(
    `SELECT r.id
       FROM ${CORE_RESUMES} r
       JOIN ${CORE_PEOPLE} c ON c.id = r.candidate_id
      WHERE r.candidate_id = $1
        AND r.is_current = true
        AND r.processed_at IS NOT NULL${extra}
      LIMIT 1`,
    params
  );
  return rows[0]?.id || null;
}

module.exports = {
  insertCandidate,
  getCandidateWithCurrentResume,
  getCurrentResumeId,
  listCandidates,
  deleteCandidate,
  deleteCandidates,
  saveProfileFields,
  updateCandidate,
  getClosestJdsCount,
  saveCandidatesBulk,
};
