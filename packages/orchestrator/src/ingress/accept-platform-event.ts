/**
 * Front door — ingress (design §6 / §9).
 *
 * Transactional outbox (single DB story):
 * 1. Validate wire envelope + per-type payload (Zod)
 * 2. INSERT event_outbox with published_at IS NULL (same org TX)
 * 3. Outbox relay is the only pg-boss publisher → ingress or dispatch
 *
 * Do NOT enqueue pg-boss here — that would split outbox write + queue send.
 */
import type { Pool } from 'pg';
import type { EventEnvelope } from '@tekisho/domain';
import { withOrgConnection } from '../db/with-org-connection.js';
import { parseEventEnvelope } from './envelope-schema.js';

export type AcceptPlatformEventResult = {
  event_id: string;
  /** Logical next hop after outbox (relay publishes). */
  queue: 'event_outbox';
  /** false when event_id was already in event_outbox (idempotent). */
  inserted: boolean;
};

export type AcceptPlatformEventDeps = {
  pool: Pool;
};

export async function acceptPlatformEvent(
  raw: unknown,
  deps: AcceptPlatformEventDeps,
): Promise<AcceptPlatformEventResult> {
  const envelope = parseEventEnvelope(raw);

  const inserted = await withOrgConnection(
    deps.pool,
    envelope.organization_id,
    async (client) => {
      const result = await client.query(
        `INSERT INTO orch.event_outbox (
           event_id, event_type, schema_version, organization_id,
           aggregate_type, aggregate_id, correlation_id, causation_id,
           producer, payload_ref, test_pin, published_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, NULL
         )
         ON CONFLICT (event_id) DO NOTHING
         RETURNING id`,
        [
          envelope.event_id,
          envelope.event_type,
          envelope.schema_version,
          envelope.organization_id,
          envelope.aggregate.type,
          envelope.aggregate.id,
          envelope.correlation_id,
          envelope.causation_id,
          envelope.producer,
          JSON.stringify(envelope.payload_ref),
          // Null for every real producer. See the note on the schema field.
          envelope.test_pin ? JSON.stringify(envelope.test_pin) : null,
        ],
      );
      return (result.rowCount ?? 0) > 0;
    },
  );

  if (inserted) {
    console.log(
      `[Ingress] ACCEPTED ${envelope.event_type} event_id=${envelope.event_id}` +
        ` org=${envelope.organization_id} → event_outbox (await relay)`,
    );
  } else {
    console.log(
      `[Ingress] DUPLICATE ${envelope.event_type} event_id=${envelope.event_id}`,
    );
  }

  return { event_id: envelope.event_id, queue: 'event_outbox', inserted };
}

/** @deprecated kept for type imports; enqueue is no longer part of accept. */
export type { EventEnvelope };
