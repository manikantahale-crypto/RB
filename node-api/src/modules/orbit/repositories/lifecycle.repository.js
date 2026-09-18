/**
 * orbit.lifecycle_states — where a consultant is (bench, notice, placed …),
 * one row per transition. Moved from repositories/lifecycle.repository.js
 * on 2026-09-18 and repointed from public.orbit_lifecycle_states
 * (V20260909.67): person_id in the table, candidate_id to callers; org_id
 * derived by trigger.
 */
const { pool } = require("../../../config/db");

const CANONICAL_STATUSES = [
  "AVAILABLE",
  "BENCH",
  "NOTICE",
  "PLACED",
  "HOLD",
  "PRIORITIZE",
  "OLD",
  "IGNORE",
];

/**
 * Fetch latest lifecycle state for a single candidate.
 */
async function getLatestLifecycleState(candidateId) {
  const sql = `
    SELECT id, person_id AS candidate_id, state, previous_state, transitioned_at, transitioned_by, note, context, created_at
      FROM orbit.lifecycle_states
     WHERE person_id = $1
     ORDER BY created_at DESC
     LIMIT 1;
  `;
  const { rows } = await pool.query(sql, [candidateId]);
  return rows[0] || null;
}

/**
 * Fetch full lifecycle transition history for a candidate.
 */
async function getLifecycleHistory(candidateId) {
  const sql = `
    SELECT id, person_id AS candidate_id, state, previous_state, transitioned_at, transitioned_by, note, context, created_at
      FROM orbit.lifecycle_states
     WHERE person_id = $1
     ORDER BY created_at DESC;
  `;
  const { rows } = await pool.query(sql, [candidateId]);
  return rows;
}


/**
 * Record a new candidate lifecycle transition.
 */
async function recordTransition({
  candidateId,
  // Derived from the person by trigger when not given (V20260909.67) — never an env default.
  organizationId = null,
  toState,
  fromState = null,
  note = null,
  context = null,
  transitionedBy = null,
}, client = null) {
  const dbClient = client || pool;
  const sql = `
    INSERT INTO orbit.lifecycle_states (
      org_id, person_id, state, previous_state, note, context, transitioned_by, transitioned_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
    RETURNING id, org_id AS organization_id, person_id AS candidate_id, state, previous_state, transitioned_at, transitioned_by, note, context, created_at;
  `;
  const { rows } = await dbClient.query(sql, [
    organizationId,
    candidateId,
    toState,
    fromState,
    note,
    context ? JSON.stringify(context) : null,
    transitionedBy,
  ]);
  return rows[0];
}

/**
 * Batch lookup of the most recent lifecycle state for multiple candidates.
 */
async function getLatestStatesForCandidates(candidateIds = []) {
  if (!candidateIds.length) return new Map();

  const sql = `
    SELECT DISTINCT ON (person_id) person_id AS candidate_id, state, transitioned_at, created_at
      FROM orbit.lifecycle_states
     WHERE person_id = ANY($1::uuid[])
     ORDER BY person_id, created_at DESC;
  `;
  const { rows } = await pool.query(sql, [candidateIds]);
  const stateMap = new Map();
  for (const row of rows) {
    stateMap.set(row.candidate_id, row.state);
  }
  return stateMap;
}

module.exports = {
  CANONICAL_STATUSES,
  getLatestLifecycleState,
  getLifecycleHistory,
  recordTransition,
  getLatestStatesForCandidates,
};
