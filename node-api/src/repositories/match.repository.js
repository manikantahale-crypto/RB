const { pool } = require("../config/db");

/*
 * READS COME FROM `core`. WRITES STILL GO TO `syntra`.
 *
 * The business entities moved to `core` and several columns were renamed on
 * the way — requirement_id, person_id, status — while three groups of columns
 * moved out into tables of their own: file metadata, embeddings, and
 * processing state.
 *
 * These four constants put them back together under the old names, so every
 * query below keeps its column references and every caller keeps its response
 * shape. The alternative was rewriting 150 column references by hand.
 *
 * Writes are NOT moved. core.matches has composite foreign keys to
 * requirements, people and resumes, so a match written to core whose job went
 * to syntra fails the key — the writes have to move as one cluster, later. The
 * mirror triggers in V20260909.15-18 carry every syntra write into core in the
 * same transaction, so these reads are never behind.
 */

/** core.matches, under the three column names that were renamed. */
const CORE_MATCHES = `(SELECT *,
         requirement_id AS job_id,
         person_id      AS candidate_id,
         status         AS match_status,
         requested_at   AS match_requested_at,
         scored_by      AS score_source
    FROM core.matches)`;

/** core.people — was syntra.candidates. Same columns, new home. */
const CORE_PEOPLE = "core.people";

/**
 * core.requirements — was syntra.jobs.
 *
 * `processed_at` is the readiness gate every matching query uses. It is no
 * longer a column: it is whether the extract stage finished. `embedding` moved
 * to core.embeddings, versioned by model, so the newest is taken.
 */
const CORE_REQUIREMENTS = `(SELECT q.*,
         q.summary AS jd_summary,
         pj.finished_at AS processed_at,
         e.embedding
    FROM core.requirements q
    LEFT JOIN LATERAL (
      SELECT p.finished_at FROM core.processing_jobs p
       WHERE p.subject_type = 'requirement' AND p.subject_id = q.id
         AND p.stage = 'extract'
       ORDER BY p.attempt DESC LIMIT 1
    ) pj ON true
    LEFT JOIN LATERAL (
      SELECT x.embedding FROM core.embeddings x
       WHERE x.subject_type = 'requirement' AND x.subject_id = q.id
       ORDER BY x.created_at DESC LIMIT 1
    ) e ON true)`;

/** core.resumes — was syntra.resumes. Same three columns moved out. */
const CORE_RESUMES = `(SELECT r.*,
         r.person_id AS candidate_id,
         r.summary AS resume_summary,
         r.current_role_title AS current_role,
         pj.finished_at AS processed_at,
         e.embedding
    FROM core.resumes r
    LEFT JOIN LATERAL (
      SELECT p.finished_at FROM core.processing_jobs p
       WHERE p.subject_type = 'resume' AND p.subject_id = r.id
         AND p.stage = 'extract'
       ORDER BY p.attempt DESC LIMIT 1
    ) pj ON true
    LEFT JOIN LATERAL (
      SELECT x.embedding FROM core.embeddings x
       WHERE x.subject_type = 'resume' AND x.subject_id = r.id
       ORDER BY x.created_at DESC LIMIT 1
    ) e ON true)`;
const { match: matchStatus } = require("../constants/statuses");

async function getJobForMatching(jobId) {
  const { rows } = await pool.query(
    `SELECT id, primary_role, required_skills, processed_at
       FROM syntra.jobs
      WHERE id = $1`,
    [jobId]
  );
  return rows[0] || null;
}

async function getResumeForMatching(resumeId) {
  const { rows } = await pool.query(
    `SELECT id, candidate_id, primary_role, skills, processed_at, is_current
       FROM syntra.resumes
      WHERE id = $1`,
    [resumeId]
  );
  return rows[0] || null;
}

async function findCandidatesForJob(jobId) {
  // Prefer same primary_role; if none, fall back to all processed current resumes
  // Enforce isolated candidate pool: candidate must be created by the same user as the job.
  const roleMatched = await pool.query(
    `SELECT r.id AS resume_id,
            r.candidate_id,
            r.primary_role,
            r.skills,
            j.id AS job_id,
            j.primary_role AS job_primary_role,
            j.required_skills
       FROM ${CORE_REQUIREMENTS} j
       JOIN ${CORE_PEOPLE} c
         ON c.org_id = j.org_id
       JOIN ${CORE_RESUMES} r
         ON r.candidate_id = c.id
        AND r.primary_role = j.primary_role
        AND r.is_current = true
        AND r.processed_at IS NOT NULL
      WHERE j.id = $1
        AND j.processed_at IS NOT NULL
        AND j.primary_role IS NOT NULL
      ORDER BY r.id`,
    [jobId]
  );
  if (roleMatched.rows.length) return roleMatched.rows;

  const { rows } = await pool.query(
    `SELECT r.id AS resume_id,
            r.candidate_id,
            r.primary_role,
            r.skills,
            j.id AS job_id,
            j.primary_role AS job_primary_role,
            j.required_skills
       FROM ${CORE_REQUIREMENTS} j
       JOIN ${CORE_PEOPLE} c
         ON c.org_id = j.org_id
       JOIN ${CORE_RESUMES} r
         ON r.candidate_id = c.id
        AND r.is_current = true
        AND r.processed_at IS NOT NULL
      WHERE j.id = $1
        AND j.processed_at IS NOT NULL
      ORDER BY r.id`,
    [jobId]
  );
  return rows;
}

async function findOpenJobsForResume(resumeId) {
  const roleMatched = await pool.query(
    `SELECT j.id AS job_id,
            j.primary_role,
            j.required_skills,
            r.id AS resume_id,
            r.candidate_id,
            r.primary_role AS resume_primary_role,
            r.skills
       FROM ${CORE_RESUMES} r
       JOIN ${CORE_PEOPLE} c
         ON c.id = r.candidate_id
       JOIN ${CORE_REQUIREMENTS} j
         ON j.org_id = c.org_id
        AND j.primary_role = r.primary_role
        AND j.processed_at IS NOT NULL
        AND j.primary_role IS NOT NULL
      WHERE r.id = $1
        AND r.is_current = true
        AND r.processed_at IS NOT NULL
        AND r.primary_role IS NOT NULL
      ORDER BY j.id`,
    [resumeId]
  );
  if (roleMatched.rows.length) return roleMatched.rows;

  const { rows } = await pool.query(
    `SELECT j.id AS job_id,
            j.primary_role,
            j.required_skills,
            r.id AS resume_id,
            r.candidate_id,
            r.primary_role AS resume_primary_role,
            r.skills
       FROM ${CORE_RESUMES} r
       JOIN ${CORE_PEOPLE} c
         ON c.id = r.candidate_id
       JOIN ${CORE_REQUIREMENTS} j
         ON j.org_id = c.org_id
        AND j.processed_at IS NOT NULL
      WHERE r.id = $1
        AND r.is_current = true
        AND r.processed_at IS NOT NULL
      ORDER BY j.id`,
    [resumeId]
  );
  return rows;
}

async function insertShortlistRow(
  client,
  { jobId, candidateId, resumeId, skillMatchScore }
) {
  const sql = `
    INSERT INTO syntra.matches (
      job_id, candidate_id, resume_id,
      match_status, skill_match_score,
      match_requested_at, created_at
    )
    VALUES ($1, $2, $3, $4, $5, now(), now())
    ON CONFLICT (job_id, resume_id) DO NOTHING
    RETURNING id
  `;
  const { rows } = await client.query(sql, [
    jobId,
    candidateId,
    resumeId,
    matchStatus.REQUESTED,
    skillMatchScore,
  ]);
  return rows[0] || null;
}

async function findMatchIdByJobResume(jobId, resumeId) {
  const { rows } = await pool.query(
    `SELECT id FROM syntra.matches WHERE job_id = $1 AND resume_id = $2`,
    [jobId, resumeId]
  );
  return rows[0]?.id || null;
}

function buildMatchFilters({ status, minScore }, alias = "m", startIndex = 1) {
  const clauses = [];
  const params = [];
  let i = startIndex;
  if (status) {
    params.push(status);
    i += 1;
    clauses.push(`${alias}.match_status = $${i}`);
  }
  if (minScore != null && !Number.isNaN(Number(minScore))) {
    params.push(Number(minScore));
    i += 1;
    clauses.push(`${alias}.score >= $${i}`);
  }
  return { clauses, params };
}

async function listMatchesForJob(jobId, { status, minScore } = {}) {
  // $1 = jobId; filters start at $2 so status never collides with the uuid param.
  const { clauses, params: filterParams } = buildMatchFilters(
    { status, minScore },
    "m",
    1
  );
  const params = [jobId, ...filterParams];
  const extra = clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT m.id AS match_id,
            m.candidate_id,
            c.full_name,
            c.email,
            m.resume_id,
            m.skill_match_score,
            m.score,
            m.tier,
            m.match_status,
            m.reasoning,
            m.strengths,
            m.gaps,
            m.green_flags,
            m.red_flags,
            m.confidence_score,
            m.breakdown,
            m.evidence,
            j.score_threshold
       FROM ${CORE_MATCHES} m
       JOIN ${CORE_PEOPLE} c ON c.id = m.candidate_id
       JOIN ${CORE_REQUIREMENTS} j ON j.id = m.job_id
      WHERE m.job_id = $1${extra}
      ORDER BY m.score DESC NULLS LAST, m.created_at DESC`,
    params
  );
  return rows;
}

async function listMatchesForCandidate(candidateId, { status, minScore } = {}) {
  const { clauses, params: filterParams } = buildMatchFilters(
    { status, minScore },
    "m",
    1
  );
  const params = [candidateId, ...filterParams];
  const extra = clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT m.id AS match_id,
            m.job_id,
            j.title AS job_title,
            m.resume_id,
            m.skill_match_score,
            m.score,
            m.tier,
            m.match_status,
            m.reasoning,
            m.strengths,
            m.gaps,
            m.green_flags,
            m.red_flags,
            m.confidence_score,
            m.breakdown,
            m.evidence,
            j.score_threshold
       FROM ${CORE_MATCHES} m
       JOIN ${CORE_REQUIREMENTS} j ON j.id = m.job_id
      WHERE m.candidate_id = $1${extra}
      ORDER BY m.score DESC NULLS LAST, m.created_at DESC`,
    params
  );
  return rows;
}

async function listTopMatches({ userId = null, limit = 5 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 50);
  const userFilter = userId
    ? "AND j.created_by = $1 AND c.created_by = $1 AND j.created_by IS NOT NULL"
    : "AND j.created_by IS NOT NULL";
  const params = userId ? [userId, safeLimit] : [safeLimit];
  const limitPlaceholder = userId ? "$2" : "$1";

  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (m.candidate_id)
              m.id AS match_id,
              m.candidate_id,
              c.full_name AS candidate_name,
              m.job_id,
              COALESCE(j.title, j.primary_role, 'Untitled role') AS job_title,
              m.score,
              m.tier,
              m.skill_match_score
         FROM ${CORE_MATCHES} m
         JOIN ${CORE_PEOPLE} c ON c.id = m.candidate_id
         JOIN ${CORE_REQUIREMENTS} j ON j.id = m.job_id
        WHERE m.match_status = 'completed'
          AND m.score IS NOT NULL
          AND c.full_name IS NOT NULL
          AND c.full_name !~* '^jd[[:space:]]'
          ${userFilter}
        ORDER BY m.candidate_id, m.score DESC NULLS LAST, m.id
     ) best
     ORDER BY best.score DESC NULLS LAST, best.match_id
     LIMIT ${limitPlaceholder}`,
    params
  );
  return rows;
}

async function getMatchById(matchId, userId = null) {
  const params = [matchId];
  let extraWhere = "";
  if (userId) {
    params.push(userId);
    extraWhere = " AND j.created_by = $2 AND c.created_by = $2";
  }

  const { rows } = await pool.query(
    `SELECT m.id,
            m.job_id,
            m.candidate_id,
            m.resume_id,
            m.match_status,
            m.skill_match_score,
            m.eligibility_score,
            m.score,
            m.tier,
            m.final_decision,
            m.reasoning,
            m.strengths,
            m.gaps,
            m.green_flags,
            m.red_flags,
            m.confidence_score,
            m.breakdown,
            m.evidence,
            m.model_name,
            m.prompt_version,
            m.llm_score,
            m.org_id,
            m.score_source,
            m.match_requested_at,
            m.matched_at,
            m.created_at,
            m.updated_at,
            c.full_name,
            c.email,
            j.title AS job_title,
            j.score_threshold
       FROM ${CORE_MATCHES} m
       JOIN ${CORE_PEOPLE} c ON c.id = m.candidate_id
       JOIN ${CORE_REQUIREMENTS} j ON j.id = m.job_id
      WHERE m.id = $1${extraWhere}`,
    params
  );
  return rows[0] || null;
}

async function dailyActivity({ userId = null, days = 7 } = {}) {
  const safeDays = Math.min(Math.max(Number(days) || 7, 1), 90);
  const userJoinFilter = userId
    ? "AND j.created_by = $2 AND j.created_by IS NOT NULL AND COALESCE(j.status, 'Active') = 'Active'"
    : "AND j.created_by IS NOT NULL AND COALESCE(j.status, 'Active') = 'Active'";
  const params = userId ? [safeDays, userId] : [safeDays];

  const { rows } = await pool.query(
    `WITH days AS (
       SELECT generate_series(
                (CURRENT_DATE - ($1::int - 1)),
                CURRENT_DATE,
                '1 day'::interval
              )::date AS date
     )
     SELECT d.date,
            (
              SELECT COUNT(*)::int FROM ${CORE_MATCHES} m
                JOIN ${CORE_REQUIREMENTS} j ON j.id = m.job_id
               WHERE COALESCE(m.match_requested_at, m.created_at)::date = d.date
                 ${userJoinFilter}
            ) AS matches_requested,
            (
              SELECT COUNT(*)::int FROM ${CORE_MATCHES} m
                JOIN ${CORE_REQUIREMENTS} j ON j.id = m.job_id
               WHERE m.match_status = 'completed'
                 AND COALESCE(m.matched_at, m.created_at)::date = d.date
                 ${userJoinFilter}
            ) AS matches_completed,
            (
              SELECT COUNT(*)::int FROM ${CORE_MATCHES} m
                JOIN ${CORE_REQUIREMENTS} j ON j.id = m.job_id
               WHERE m.match_status = 'completed'
                 AND m.score >= 60
                 AND COALESCE(m.matched_at, m.created_at)::date = d.date
                 ${userJoinFilter}
            ) AS eligible_matches
       FROM days d
      ORDER BY d.date`,
    params
  );
  return rows;
}

async function markMatching(jobId, resumeId) {
  await pool.query(
    `UPDATE syntra.matches
        SET match_status = $3,
            matching_started_at = now(),
            matching_failed_at = NULL,
            matching_error = NULL
      WHERE job_id = $1 AND resume_id = $2`,
    [jobId, resumeId, matchStatus.PROCESSING]
  );
}

async function saveScoreResult(
  jobId,
  resumeId,
  {
    score,
    tier,
    reasoning,
    strengths,
    gaps,
    greenFlags,
    redFlags,
    confidenceScore,
    breakdown,
    evidence,
    modelName,
  }
) {
  const { rows } = await pool.query(
    `UPDATE syntra.matches
        SET score = $3,
            tier = $4,
            reasoning = $5,
            strengths = $6::jsonb,
            gaps = $7::jsonb,
            green_flags = $8::jsonb,
            red_flags = $9::jsonb,
            confidence_score = $10,
            breakdown = $11::jsonb,
            evidence = $12::jsonb,
            match_status = $13,
            matched_at = now(),
            matching_failed_at = NULL,
            matching_error = NULL,
            model_name = $14,
            prompt_version = 'v2',
            updated_at = now()
      WHERE job_id = $1 AND resume_id = $2
  RETURNING id`,
    [
      jobId,
      resumeId,
      score,
      tier,
      reasoning,
      JSON.stringify(strengths || []),
      JSON.stringify(gaps || []),
      JSON.stringify(greenFlags || []),
      JSON.stringify(redFlags || []),
      confidenceScore != null ? Number(confidenceScore) : 0,
      JSON.stringify(breakdown || {}),
      JSON.stringify(evidence || {}),
      matchStatus.COMPLETED,
      modelName || null,
    ]
  );
  return rows[0] || null;
}

async function markFailed(jobId, resumeId, error) {
  await pool.query(
    `UPDATE syntra.matches
        SET match_status = $3,
            matching_failed_at = now(),
            matching_error = $4
      WHERE job_id = $1 AND resume_id = $2`,
    [jobId, resumeId, matchStatus.FAILED, String(error).slice(0, 2000)]
  );
}

async function getSummariesForScoring(jobId, resumeId) {
  const { rows } = await pool.query(
    `SELECT j.jd_summary,
            j.score_threshold,
            r.resume_summary,
            r.candidate_id
       FROM ${CORE_REQUIREMENTS} j
       CROSS JOIN ${CORE_RESUMES} r
      WHERE j.id = $1 AND r.id = $2`,
    [jobId, resumeId]
  );
  return rows[0] || null;
}

async function saveCandidateFailure(jobId, resumeId, { stage, errorCode, errorMessage, retryable } = {}) {
  const errorStr = `${errorCode || "ERROR"}: ${errorMessage || "Match failed"}`;
  await markFailed(jobId, resumeId, errorStr);
}

module.exports = {
  getJobForMatching,
  getResumeForMatching,
  findCandidatesForJob,
  findOpenJobsForResume,
  insertShortlistRow,
  findMatchIdByJobResume,
  listMatchesForJob,
  listMatchesForCandidate,
  listTopMatches,
  getMatchById,
  dailyActivity,
  markMatching,
  saveScoreResult,
  markFailed,
  saveCandidateFailure,
  getSummariesForScoring,
};

async function findTopJobsByVector(resumeId, limit = 50) {
  // Retrieve resume embedding
  const { rows: resumeRows } = await pool.query(
    `SELECT embedding FROM syntra.resumes WHERE id = $1`, 
    [resumeId]
  );
  const resumeEmbedding = resumeRows[0]?.embedding;
  if (!resumeEmbedding) return [];

  // Find most similar current/processed job descriptions
  const { rows } = await pool.query(
    `SELECT j.id AS job_id,
            j.primary_role,
            j.required_skills,
            r.id AS resume_id,
            r.candidate_id,
            r.primary_role AS resume_primary_role,
            r.skills
       FROM ${CORE_REQUIREMENTS} j
       JOIN ${CORE_RESUMES} r ON r.id = $2
       JOIN ${CORE_PEOPLE} c ON r.candidate_id = c.id
      WHERE j.org_id = c.org_id
        AND j.processed_at IS NOT NULL
        AND j.embedding IS NOT NULL
        AND r.is_current = true
        AND r.processed_at IS NOT NULL
      ORDER BY j.embedding <=> $1::vector ASC
      LIMIT $3`,
    [resumeEmbedding, resumeId, limit]
  );
  
  return rows;
}

module.exports.findTopJobsByVector = findTopJobsByVector;

async function findTopCandidatesByVector(jobId, limit = 50) {
  // Retrieve job embedding
  const { rows: jobRows } = await pool.query(
    `SELECT embedding FROM syntra.jobs WHERE id = $1`, 
    [jobId]
  );
  const jobEmbedding = jobRows[0]?.embedding;
  if (!jobEmbedding) return [];

  // Find most similar current/processed resumes
  const { rows } = await pool.query(
    `SELECT r.id AS resume_id,
            r.candidate_id,
            r.primary_role AS resume_primary_role,
            r.skills,
            j.id AS job_id,
            j.primary_role,
            j.required_skills
       FROM ${CORE_RESUMES} r
       JOIN ${CORE_PEOPLE} c ON r.candidate_id = c.id
       JOIN ${CORE_REQUIREMENTS} j ON j.id = $2
      WHERE c.org_id = j.org_id
        AND j.processed_at IS NOT NULL
        AND r.is_current = true
        AND r.processed_at IS NOT NULL
        AND r.embedding IS NOT NULL
      ORDER BY r.embedding <=> $1::vector ASC
      LIMIT $3`,
    [jobEmbedding, jobId, limit]
  );
  
  return rows;
}

module.exports.findTopCandidatesByVector = findTopCandidatesByVector;

/** Why tier-1 vector pool may be empty for a job (diagnostics only). */
async function countMatchPoolDiagnostics(jobId) {
  const { rows } = await pool.query(
    `SELECT j.org_id::text AS job_owner,
            (SELECT COUNT(*)::int
               FROM ${CORE_RESUMES} r
              WHERE r.is_current = true
                AND r.processed_at IS NOT NULL
                AND r.embedding IS NOT NULL) AS resumes_ready,
            (SELECT COUNT(*)::int
               FROM ${CORE_RESUMES} r
               JOIN ${CORE_PEOPLE} c ON r.candidate_id = c.id
              WHERE c.org_id = j.org_id
                AND r.is_current = true
                AND r.processed_at IS NOT NULL
                AND r.embedding IS NOT NULL) AS resumes_same_owner
       FROM ${CORE_REQUIREMENTS} j
      WHERE j.id = $1`,
    [jobId]
  );
  return rows[0] || null;
}

module.exports.countMatchPoolDiagnostics = countMatchPoolDiagnostics;
