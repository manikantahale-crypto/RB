const outboxRepo = require("../../../repositories/outbox.repository");
const env = require("../../../config/env");
const log = require("../../../utils/logger");

function eventsEnabled() {
  return env.PLATFORM_EVENTS_ENABLED !== false && env.PLATFORM_EVENTS_ENABLED !== "0";
}

/**
 * Insert an ORBIT platform event into orch.event_outbox (transactional when client provided).
 */
async function emitOrbitEvent(client, {
  eventType,
  aggregateType,
  aggregateId,
  producer,
  payload,
  organizationId,
  correlationId,
}) {
  if (!eventsEnabled()) {
    return null;
  }

  // When the caller does not know, insertEvent takes the organisation from
  // the aggregate (the person, the placement) — not from the env.
  return outboxRepo.insertEvent(client, {
    eventType,
    organizationId: organizationId || null,
    aggregateType,
    aggregateId,
    correlationId,
    producer,
    payload,
  });
}

/** Optional direct POST to orch ingress (fail-open; worker relay is primary). */
async function publishToOrchFailOpen(envelope) {
  if (!envelope) return;

  const base = (env.ORCH_API_URL || "").replace(/\/$/, "");
  if (!base) return;

  const {
    event_id: eventId,
    eventType,
    organizationId,
    aggregateType,
    aggregateId,
    correlation_id: correlationId,
    producer,
    payload,
  } = envelope;

  try {
    const res = await fetch(`${base}/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: eventId,
        event_type: eventType,
        schema_version: "1.0",
        organization_id: organizationId,
        aggregate: { type: aggregateType, id: aggregateId },
        correlation_id: correlationId,
        producer,
        payload_ref: payload,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.warn(
        `[orbit.outbox] ORCH publish ${eventType} failed status=${res.status} ${body.slice(0, 200)}`,
      );
    }
  } catch (err) {
    log.warn(`[orbit.outbox] ORCH publish ${eventType} error: ${err.message}`);
  }
}

/**
 * Emit to outbox; caller invokes publishToOrchFailOpen after commit if desired.
 */
async function emitAndMaybePublish(client, fields) {
  const row = await emitOrbitEvent(client, fields);
  if (!row) return null;

  log.info(`[ORBIT] EMIT ${fields.eventType} aggregate=${fields.aggregateType}:${fields.aggregateId}`);

  return {
    event_id: row.event_id,
    correlation_id: row.correlation_id,
    eventType: fields.eventType,
    organizationId:
      fields.organizationId ||
      env.ORCH_ORGANIZATION_ID ||
      "00000000-0000-0000-0000-000000000001",
    aggregateType: fields.aggregateType,
    aggregateId: fields.aggregateId,
    producer: fields.producer,
    payload: fields.payload,
  };
}

module.exports = {
  emitOrbitEvent,
  publishToOrchFailOpen,
  emitAndMaybePublish,
};
