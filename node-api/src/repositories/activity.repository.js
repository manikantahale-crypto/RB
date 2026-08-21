const { pool } = require("../config/db");

/**
 * Fetch chronological activity history for a candidate.
 */
async function getActivitiesForCandidate(candidateId, { limit = 50, before = null } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const params = [candidateId, safeLimit];
  let beforeClause = "";

  if (before) {
    params.push(before);
    beforeClause = `AND occurred_at < $3`;
  }

  const sql = `
    SELECT id, candidate_id, activity_type, actor_type, actor_id, summary, payload, occurred_at, created_at
      FROM public.orbit_activities
     WHERE candidate_id = $1
     ${beforeClause}
     ORDER BY occurred_at DESC
     LIMIT $2;
  `;
  const { rows } = await pool.query(sql, params);
  return rows;
}

/**
 * Log a candidate activity or recruiter note.
 */
async function createActivity({
  candidateId,
  activityType,
  actorType = "USER",
  actorId = null,
  summary,
  payload = {},
}, client = null) {
  const dbClient = client || pool;
  const sql = `
    INSERT INTO public.orbit_activities (
      candidate_id, activity_type, actor_type, actor_id, summary, payload, occurred_at
    ) VALUES ($1, $2, $3, $4, $5, $6, now())
    RETURNING id, candidate_id, activity_type, actor_type, actor_id, summary, payload, occurred_at, created_at;
  `;
  const values = [
    candidateId,
    activityType,
    actorType,
    actorId,
    summary,
    payload ? JSON.stringify(payload) : "{}",
  ];
  const { rows } = await dbClient.query(sql, values);
  return rows[0];
}

module.exports = {
  getActivitiesForCandidate,
  createActivity,
};
