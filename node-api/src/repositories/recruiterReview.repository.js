const { pool } = require("../config/db");
const crypto = require("crypto");

let schemaReady = null;

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = pool.query(`
    CREATE TABLE IF NOT EXISTS syntra.recruiter_review_items (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         uuid,
      organization_id uuid,
      action_type     text NOT NULL,
      status          text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected', 'dismissed')),
      title           text NOT NULL,
      message         text NOT NULL,
      payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
      source_event_type text,
      source_event_id uuid,
      created_at      timestamptz NOT NULL DEFAULT now(),
      decided_at      timestamptz,
      decided_by      uuid,
      decision_note   text
    );
    CREATE INDEX IF NOT EXISTS recruiter_review_pending_user_idx
      ON syntra.recruiter_review_items (user_id, status, created_at DESC)
      WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS recruiter_review_source_event_idx
      ON syntra.recruiter_review_items (source_event_id)
      WHERE source_event_id IS NOT NULL;
  `);
  return schemaReady;
}

async function findExistingBySourceEvent(sourceEventId) {
  const { rows } = await pool.query(
    `SELECT id::text FROM syntra.recruiter_review_items WHERE source_event_id = $1 LIMIT 1`,
    [sourceEventId],
  );
  return rows[0]?.id || null;
}

async function insertItem({
  userId,
  organizationId,
  actionType,
  title,
  message,
  payload,
  sourceEventType,
  sourceEventId,
}) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO syntra.recruiter_review_items (
       id, user_id, organization_id, action_type, title, message,
       payload, source_event_type, source_event_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      userId || null,
      organizationId || null,
      actionType,
      title,
      message,
      JSON.stringify(payload || {}),
      sourceEventType || null,
      sourceEventId || null,
    ],
  );
  return id;
}

async function listPendingForUser({ userId, organizationId, limit = 30 }) {
  const { rows } = await pool.query(
    `SELECT id::text, user_id::text, organization_id::text, action_type, status,
            title, message, payload, source_event_type, source_event_id::text,
            created_at
       FROM syntra.recruiter_review_items
      WHERE status = 'pending'
        AND (
          user_id = $1
          OR (user_id IS NULL AND ($2::uuid IS NULL OR organization_id = $2))
        )
      ORDER BY created_at DESC
      LIMIT $3`,
    [userId, organizationId || null, limit],
  );
  return rows;
}

async function getByIdForUser(id, userId) {
  const { rows } = await pool.query(
    `SELECT id::text, user_id::text, organization_id::text, action_type, status,
            title, message, payload, source_event_type, source_event_id::text,
            created_at
       FROM syntra.recruiter_review_items
      WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)`,
    [id, userId],
  );
  return rows[0] || null;
}

async function markDecided(id, { userId, status, note }) {
  const { rowCount } = await pool.query(
    `UPDATE syntra.recruiter_review_items
        SET status = $3,
            decided_at = now(),
            decided_by = $2,
            decision_note = $4
      WHERE id = $1 AND status = 'pending'`,
    [id, userId, status, note || null],
  );
  return rowCount > 0;
}

async function resolveCandidateOwner(candidateId) {
  if (!candidateId) return null;
  const { rows } = await pool.query(
    `SELECT created_by::text AS user_id FROM syntra.candidates WHERE id = $1`,
    [candidateId],
  );
  return rows[0]?.user_id || null;
}

async function syncHumanEventsFromOutbox(organizationId) {
  const params = [organizationId || null];
  const orgFilter = organizationId
    ? "AND organization_id = $1::uuid"
    : "";

  const { rows } = await pool.query(
    `SELECT event_id::text, event_type, organization_id::text,
            payload_ref, correlation_id::text, occurred_at
       FROM event_outbox
      WHERE event_type IN (
              'syntra.approval.requested',
              'syntra.duplicate.review_required'
            )
        AND occurred_at > now() - interval '30 days'
        ${orgFilter}
      ORDER BY occurred_at DESC
      LIMIT 100`,
    organizationId ? params : [],
  );

  let inserted = 0;
  for (const row of rows) {
    const exists = await findExistingBySourceEvent(row.event_id);
    if (exists) continue;

    const payload =
      typeof row.payload_ref === "object" && row.payload_ref
        ? row.payload_ref
        : {};

    let userId = null;
    if (row.event_type === "syntra.duplicate.review_required") {
      userId =
        (await resolveCandidateOwner(payload.candidate_a)) ||
        (await resolveCandidateOwner(payload.candidate_b));
    }

    const title =
      row.event_type === "syntra.duplicate.review_required"
        ? "Duplicate candidate review needed"
        : "Recruiter approval needed";

    const message =
      row.event_type === "syntra.duplicate.review_required"
        ? "The workflow detected a probable duplicate candidate pair. Review and confirm merge or keep separate."
        : `Orchestration paused for human review (${payload.reason || payload.gate || "approval"}).`;

    await insertItem({
      userId,
      organizationId: row.organization_id || organizationId,
      actionType:
        row.event_type === "syntra.duplicate.review_required"
          ? "duplicate_review"
          : "approval",
      title,
      message,
      payload: {
        ...payload,
        correlation_id: row.correlation_id,
        occurred_at: row.occurred_at,
      },
      sourceEventType: row.event_type,
      sourceEventId: row.event_id,
    });
    inserted += 1;
  }
  return inserted;
}

async function syncParkedRuns(organizationId) {
  try {
    const params = organizationId ? [organizationId] : [];
    const orgFilter = organizationId ? "AND organization_id = $1::uuid" : "";
    const { rows } = await pool.query(
      `SELECT id::text, organization_id::text, agent_name, graph_key,
              langgraph_thread_id, trigger_event_id::text, created_at
         FROM orch.runs
        WHERE status = 'PARKED'
          ${orgFilter}
        ORDER BY created_at DESC
        LIMIT 50`,
      params,
    );

    let inserted = 0;
    for (const row of rows) {
      const syntheticEventId = row.id;
      const exists = await findExistingBySourceEvent(syntheticEventId);
      if (exists) continue;

      await insertItem({
        userId: null,
        organizationId: row.organization_id || organizationId,
        actionType: "workflow_parked",
        title: "Workflow waiting for recruiter",
        message: `Agent "${row.agent_name}" paused on graph ${row.graph_key}. Your decision is required to continue.`,
        payload: {
          run_id: row.id,
          thread_id: row.langgraph_thread_id,
          graph_key: row.graph_key,
          trigger_event_id: row.trigger_event_id,
        },
        sourceEventType: "orch.run.parked",
        sourceEventId: syntheticEventId,
      });
      inserted += 1;
    }
    return inserted;
  } catch (err) {
    if (/does not exist|permission denied/i.test(err.message)) return 0;
    throw err;
  }
}

module.exports = {
  ensureSchema,
  insertItem,
  listPendingForUser,
  getByIdForUser,
  markDecided,
  syncHumanEventsFromOutbox,
  syncParkedRuns,
  resolveCandidateOwner,
};
