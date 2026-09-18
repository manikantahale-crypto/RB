/**
 * core.activities — what happened to a person, in order.
 *
 * Shared, so it lives at the root: on the old project this was
 * public.orbit_activities and ORBIT wrote 2% of it — SYNTRA's match
 * completions, ASTRA's discovery, PRISM's consent steps and profile updates
 * wrote the rest (ref/ORBIT_Onboarding.md §2.2, decision D2). Every module
 * appends to it; the candidate drawer reads it.
 *
 * The column is person_id (core.people); callers still say candidateId and
 * get candidate_id back, the same aliasing core-views.js uses for SYNTRA.
 * org_id is derived from the person by trigger (V20260909.66).
 */
const { pool } = require("../config/db");

const COLS = `id, person_id AS candidate_id, activity_type, actor_type, actor_id, summary, payload, occurred_at, created_at`;

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
    SELECT ${COLS}
      FROM core.activities
     WHERE person_id = $1
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
    INSERT INTO core.activities (
      person_id, activity_type, actor_type, actor_id, summary, payload, occurred_at
    ) VALUES ($1, $2, $3, $4, $5, $6, now())
    RETURNING ${COLS};
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
