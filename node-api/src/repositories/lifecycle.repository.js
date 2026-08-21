const { pool } = require("../config/db");

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
    SELECT id, candidate_id, state, previous_state, transitioned_at, transitioned_by, note, context, created_at
      FROM public.orbit_lifecycle_states
     WHERE candidate_id = $1
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
    SELECT id, candidate_id, state, previous_state, transitioned_at, transitioned_by, note, context, created_at
      FROM public.orbit_lifecycle_states
     WHERE candidate_id = $1
     ORDER BY created_at DESC;
  `;
  const { rows } = await pool.query(sql, [candidateId]);
  return rows;
}

const env = require("../config/env");

/**
 * Record a new candidate lifecycle transition.
 */
async function recordTransition({
  candidateId,
  organizationId = env.ORCH_ORGANIZATION_ID || "00000000-0000-0000-0000-000000000000",
  toState,
  fromState = null,
  note = null,
  context = null,
  transitionedBy = null,
}, client = null) {
  const dbClient = client || pool;
  const sql = `
    INSERT INTO public.orbit_lifecycle_states (
      organization_id, candidate_id, state, previous_state, note, context, transitioned_by, transitioned_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
    RETURNING id, organization_id, candidate_id, state, previous_state, transitioned_at, transitioned_by, note, context, created_at;
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
    SELECT DISTINCT ON (candidate_id) candidate_id, state, transitioned_at, created_at
      FROM public.orbit_lifecycle_states
     WHERE candidate_id = ANY($1::uuid[])
     ORDER BY candidate_id, created_at DESC;
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
