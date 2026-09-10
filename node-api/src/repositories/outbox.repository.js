const { pool } = require("../config/db");
const crypto = require("crypto");
const env = require("../config/env");
const PLATFORM = require("../constants/platformEvents");

/** Syntra + ASTRA platform events — FK-safe seed for event_outbox. */
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
 * Seed the event catalogue so outbox inserts satisfy their FK (orch Flyway may
 * already have these).
 *
 * `application` is derived from the name prefix the one way the platform does
 * it, rather than left NULL — see registerEvent in packages/authoring. These
 * rows reach the legacy public.event_schemas, which is what the outbox FK
 * still points at, through the mirror in V20260909.34.
 */
async function seedEventSchemas() {
  for (const eventType of PLATFORM_EVENT_TYPES) {
    await pool.query(
      `INSERT INTO authoring.event_catalog (
         event_type, schema_version, application, description,
         payload_schema, envelope_fields, status
       ) VALUES (
         $1, '1.0',
         (SELECT a.key FROM platform.applications a
           WHERE $1 LIKE a.key || '.%' LIMIT 1),
         $2, '{}'::jsonb, '{}'::jsonb, 'active'
       )
       ON CONFLICT (event_type, schema_version) DO NOTHING`,
      [eventType, `Syntra platform event: ${eventType}`],
    );
  }
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
    INSERT INTO public.event_outbox (
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
