const { pool } = require("../config/db");
const crypto = require("crypto");
const env = require("../config/env");
const PLATFORM = require("../constants/platformEvents");
const log = require("../utils/logger");

/** Every event type this service emits. Checked against the catalogue at boot — never written. */
const PLATFORM_EVENT_TYPES = [
  PLATFORM.JD_RECEIVED,
  PLATFORM.JD_PARSED,
  PLATFORM.RESUME_RECEIVED,
  PLATFORM.PROFILE_PREPARED,
  PLATFORM.MATCH_REQUESTED,
  "syntra.duplicate.review_required",
  "syntra.approval.requested",
  "astra.requirement.received",
  "astra.requirement.normalized",
  "syntra.jd.normalized",
  // ORBIT — UI lifecycle / placement / activity (orbit_events_SAO)
  "orbit.lifecycle.transition_requested",
  "orbit.lifecycle.transitioned",
  "orbit.placement.confirm_requested",
  "orbit.placement.confirmed",
  "orbit.revenue.arrange_requested",
  "orbit.revenue.arranged",
  "orbit.activity.note_requested",
  "orbit.activity.noted",
  "orbit.bench.hold",
];

/**
 * Check that the events this service emits are in the catalogue. Read-only.
 *
 * This used to INSERT them, with payload_schema = '{}', ON CONFLICT DO NOTHING.
 * That did two things nobody wanted: an empty schema switches off the ingress
 * gate's input check, idempotency keys and trigger ranking for that event, and
 * DO NOTHING meant a row deliberately deleted by a migration came back at the
 * next boot (the astra.* ghosts, V20260909.57 → .68). The catalogue is the
 * platform's — migrations write it (V20260909.60, .68), code does not.
 *
 * So this only looks. A missing entry is logged loudly at startup, which is
 * where somebody will read it, and the outbox insert for that event will then
 * fail its foreign key, which is the right outcome: an event nobody wrote down
 * must not be published.
 *
 * @returns {Promise<string[]>} the event types not found in the catalogue
 */
async function seedEventSchemas() {
  const { rows } = await pool.query(
    `SELECT event_type FROM authoring.event_catalog
      WHERE event_type = ANY($1::text[])`,
    [PLATFORM_EVENT_TYPES],
  );
  const present = new Set(rows.map((r) => r.event_type));
  const missing = PLATFORM_EVENT_TYPES.filter((t) => !present.has(t));
  if (missing.length) {
    log.error(
      `[event catalogue] ${missing.length} event type(s) this service emits are not in ` +
      `authoring.event_catalog and will be REFUSED by the outbox: ${missing.join(", ")}. ` +
      `Add them with a migration (see V20260909.60 for the shape); this code will not.`,
    );
  }
  return missing;
}

/**
 * Inserts a platform event into the public.event_outbox table.
 * Uses the supplied transaction client if available to ensure atomic outbox writes.
 */
async function insertEvent(client, {
  eventType,
  organizationId = env.ORCH_ORGANIZATION_ID || "00000000-0000-0000-0000-000000000001",
  aggregateType = "requirement",
  aggregateId,
  correlationId,
  causationId = null,
  producer,
  payload
}) {
  const dbClient = client || pool;
  const eventId = crypto.randomUUID();
  const corrId = correlationId || crypto.randomUUID();

  const sql = `
    INSERT INTO orch.event_outbox (
      event_id,
      event_type,
      schema_version,
      organization_id,
      aggregate_type,
      aggregate_id,
      correlation_id,
      causation_id,
      producer,
      payload_ref,
      occurred_at
    ) VALUES ($1, $2, '1.0', $3, $4, $5, $6, $7, $8, $9, now())
    RETURNING event_id, correlation_id
  `;

  const { rows } = await dbClient.query(sql, [
    eventId,
    eventType,
    organizationId,
    aggregateType,
    aggregateId,
    corrId,
    causationId,
    producer,
    JSON.stringify(payload)
  ]);
  return rows[0];
}

module.exports = {
  seedEventSchemas,
  insertEvent
};
