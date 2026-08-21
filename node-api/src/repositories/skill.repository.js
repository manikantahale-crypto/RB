const { pool } = require("../config/db");

/**
 * Most frequent skills across jobs.required_skills (jsonb array).
 */
async function listTopSkills({ userId = null, limit = 10 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 100);
  const whereClause = userId
    ? "WHERE j.created_by = $1 AND j.created_by IS NOT NULL AND trim(skill) <> '' AND COALESCE(j.status, 'Active') = 'Active'"
    : "WHERE j.created_by IS NOT NULL AND trim(skill) <> '' AND COALESCE(j.status, 'Active') = 'Active'";
  const params = userId ? [userId, safeLimit] : [safeLimit];
  const limitPlaceholder = userId ? "$2" : "$1";

  const { rows } = await pool.query(
    `SELECT trim(skill) AS skill, COUNT(*)::int AS count
       FROM syntra.jobs j,
            LATERAL jsonb_array_elements_text(
              COALESCE(j.required_skills, '[]'::jsonb)
            ) AS skill
      ${whereClause}
      GROUP BY trim(skill)
      ORDER BY count DESC, skill ASC
      LIMIT ${limitPlaceholder}`,
    params
  );
  return rows;
}

module.exports = { listTopSkills };
