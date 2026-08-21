const { pool } = require("../config/db");
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
       FROM syntra.jobs j
       JOIN syntra.candidates c
         ON c.created_by = j.created_by
        AND c.created_by IS NOT NULL
       JOIN syntra.resumes r
         ON r.candidate_id = c.id
        AND r.primary_role = j.primary_role
        AND r.is_current = true
        AND r.processed_at IS NOT NULL
      WHERE j.id = $1
        AND j.processed_at IS NOT NULL
        AND j.primary_role IS NOT NULL
        AND j.created_by IS NOT NULL`,
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
       FROM syntra.jobs j
       JOIN syntra.candidates c
         ON c.created_by = j.created_by
        AND c.created_by IS NOT NULL
       JOIN syntra.resumes r
         ON r.candidate_id = c.id
        AND r.is_current = true
        AND r.processed_at IS NOT NULL
      WHERE j.id = $1
        AND j.processed_at IS NOT NULL
        AND j.created_by IS NOT NULL`,
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
       FROM syntra.resumes r
       JOIN syntra.candidates c
         ON c.id = r.candidate_id
        AND c.created_by IS NOT NULL
       JOIN syntra.jobs j
         ON j.created_by = c.created_by
        AND j.primary_role = r.primary_role
        AND j.processed_at IS NOT NULL
        AND j.primary_role IS NOT NULL
        AND j.created_by IS NOT NULL
      WHERE r.id = $1
        AND r.is_current = true
        AND r.processed_at IS NOT NULL
        AND r.primary_role IS NOT NULL`,
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
       FROM syntra.resumes r
       JOIN syntra.candidates c
         ON c.id = r.candidate_id
        AND c.created_by IS NOT NULL
       JOIN syntra.jobs j
         ON j.created_by = c.created_by
        AND j.processed_at IS NOT NULL
        AND j.created_by IS NOT NULL
      WHERE r.id = $1
        AND r.is_current = true
        AND r.processed_at IS NOT NULL`,
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
       FROM syntra.matches m
       JOIN syntra.candidates c ON c.id = m.candidate_id
       JOIN syntra.jobs j ON j.id = m.job_id
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
       FROM syntra.matches m
       JOIN syntra.jobs j ON j.id = m.job_id
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
         FROM syntra.matches m
         JOIN syntra.candidates c ON c.id = m.candidate_id
         JOIN syntra.jobs j ON j.id = m.job_id
        WHERE m.match_status = 'completed'
          AND m.score IS NOT NULL
          AND c.full_name IS NOT NULL
          AND c.full_name !~* '^jd[[:space:]]'
          ${userFilter}
        ORDER BY m.candidate_id, m.score DESC
     ) best
     ORDER BY best.score DESC
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
    `SELECT m.*,
            c.full_name,
            c.email,
            j.title AS job_title,
            j.score_threshold
       FROM syntra.matches m
       JOIN syntra.candidates c ON c.id = m.candidate_id
       JOIN syntra.jobs j ON j.id = m.job_id
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
              SELECT COUNT(*)::int FROM syntra.matches m
                JOIN syntra.jobs j ON j.id = m.job_id
               WHERE COALESCE(m.match_requested_at, m.created_at)::date = d.date
                 ${userJoinFilter}
            ) AS matches_requested,
            (
              SELECT COUNT(*)::int FROM syntra.matches m
                JOIN syntra.jobs j ON j.id = m.job_id
               WHERE m.match_status = 'completed'
                 AND COALESCE(m.matched_at, m.created_at)::date = d.date
                 ${userJoinFilter}
            ) AS matches_completed,
            (
              SELECT COUNT(*)::int FROM syntra.matches m
                JOIN syntra.jobs j ON j.id = m.job_id
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
       FROM syntra.jobs j
       CROSS JOIN syntra.resumes r
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
       FROM syntra.jobs j
       JOIN syntra.resumes r ON r.id = $2
       JOIN syntra.candidates c ON r.candidate_id = c.id
      WHERE j.created_by = c.created_by
        AND j.created_by IS NOT NULL
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
       FROM syntra.resumes r
       JOIN syntra.candidates c ON r.candidate_id = c.id
       JOIN syntra.jobs j ON j.id = $2
      WHERE c.created_by = j.created_by
        AND c.created_by IS NOT NULL
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
